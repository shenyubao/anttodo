import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeeklyReportOkrSection } from "./WeeklyReportOkrSection";
import { createDemoOkrData } from "./lib/demoOkr";
import { selectableWeeklyReportOkrObjectives, type WeeklyReportOkrData } from "./lib/weeklyReportOkr";

const { load, callbacks } = vi.hoisted(() => ({load:vi.fn(), callbacks:[] as Array<()=>void>}));
vi.mock("./lib/weeklyReportOkrApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/weeklyReportOkrApi")>(), loadWeeklyReportOkrData:load,
}));
vi.mock("./lib/supabase", () => ({supabase:{channel:()=>{
  const channel={on:(_event:unknown,_filter:unknown,callback:()=>void)=>{callbacks.push(callback);return channel;},subscribe:()=>channel};
  return channel;
},removeChannel:vi.fn()}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;
let queryClient:QueryClient;
afterEach(async()=>{await act(async()=>root?.unmount());queryClient?.clear();document.body.replaceChildren();vi.restoreAllMocks();load.mockReset();callbacks.length=0;});
function dataFixture():WeeklyReportOkrData {
  const {cycles,sets}=createDemoOkrData("workspace-team",new Date("2026-10-16T12:00:00"));
  const objectives=selectableWeeklyReportOkrObjectives(sets.flatMap((set)=>set.objectives.map((objective)=>({objective,ownerId:set.owner_id,cycle:cycles.find((cycle)=>cycle.id===set.cycle_id)!}))),"demo-user");
  const kr=objectives[0].objective.key_results[0];
  return {objectives,records:[
    {id:"this-week",objective_id:null,key_result_id:kr.id,workspace_id:"workspace-team",actor_id:"demo-user",previous_value:20,current_value:60,previous_status:"none",current_status:"normal",detail:"完成回归",created_at:new Date("2026-10-16T10:00:00").toISOString()},
    {id:"old",objective_id:null,key_result_id:kr.id,workspace_id:"workspace-team",actor_id:"demo-user",previous_value:0,current_value:20,previous_status:"none",current_status:"risk",detail:"历史进展",created_at:new Date("2026-10-10T10:00:00").toISOString()},
  ]};
}
async function render(options:{value?:string;readOnly?:boolean}={}) {
  queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const container=document.createElement("div");document.body.append(container);root=createRoot(container);
  function Editor(){const [value,setValue]=useState(options.value??"");return <WeeklyReportOkrSection workspaceId="workspace-team" currentUserId="demo-user" weekStart="2026-10-12" members={[]} readOnly={options.readOnly??false} demoMode={false} value={value} onChange={setValue}/>;}
  await act(async()=>root.render(<QueryClientProvider client={queryClient}><Editor/></QueryClientProvider>));
  // Wait for React Query's batched notification, not a network operation.
  await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,20));});
  return document.body;
}
function generate(container:HTMLElement){return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button)=>button.textContent==="确定")!;}

async function openPicker(container: HTMLElement) {
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "从OKR选择")!.click());
}

describe("weekly report OKR picker",()=>{
  it("selects records, switches to all, generates text and confirms replacement without changing text on selection",async()=>{
    load.mockResolvedValue(dataFixture());
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    const container=await render({value:"手写正文"});
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await openPicker(container);
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(generate(container).disabled).toBe(true);
    await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("手写正文");
    await act(async()=>generate(container).click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("手写正文");
    confirm.mockReturnValue(true);
    await act(async()=>generate(container).click());
    const text=container.querySelector<HTMLTextAreaElement>("textarea")!.value;
    expect(text).toContain("1016 正常 完成回归");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await openPicker(container);
    const select=container.querySelector("select")!;
    await act(async()=>{select.value="all";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(text);
    expect(container.querySelector<HTMLInputElement>('[aria-label="选择进展 完成回归"]')!.checked).toBe(true);
  });
  it("cancels selection without replacing the report text", async () => {
    load.mockResolvedValue(dataFixture());
    const container = await render({ value: "保留手写内容" });
    await openPicker(container);
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "取消")!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("保留手写内容");
  });
  it("hides an empty region but retains existing saved text",async()=>{
    load.mockResolvedValue({objectives:[],records:[]});
    const container=await render({value:"已保存的 OKR 正文"});
    expect(container.querySelector("h2")?.textContent).toBe("OKR 进展");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("已保存的 OKR 正文");
  });
  it("hides the region for users without OKR",async()=>{
    load.mockResolvedValue({objectives:[],records:[]});
    expect((await render()).textContent).toBe("");
  });
  it("disables all mutations while offline",async()=>{
    load.mockResolvedValue(dataFixture());
    const container=await render({readOnly:true,value:"已有正文"});
    const trigger = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "从OKR选择")!;
    expect(trigger.disabled).toBe(true);
    await act(async () => trigger.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.readOnly).toBe(true);
  });
  it("offers retry on a failed load without losing the body",async()=>{
    load.mockRejectedValueOnce(new Error("network")).mockResolvedValue(dataFixture());
    const container=await render({value:"保留正文"});
    await openPicker(container);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    const retry=[...container.querySelectorAll<HTMLButtonElement>("button")].find((button)=>button.textContent==="重试")!;
    await act(async()=>retry.click());
    await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,20));});
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("保留正文");
  });
});
