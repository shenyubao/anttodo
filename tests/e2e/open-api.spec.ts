import {test,expect} from '@playwright/test';
test('public OpenAPI documentation keeps debugger credentials in memory',async({page})=>{
  await page.route('**/api/open/v1/**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(route.request().url().endsWith('/workspaces')?[{id:'f1000000-0000-4000-8000-000000000001',name:'Fixture team'}]:{id:'fixture'})}));
  await page.goto('/openapi');
  await expect(page.getByRole('heading',{name:'OpenAPI',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'测试运行',exact:true}).click();
  await page.getByLabel('Bearer Token',{exact:true}).fill('ato_v1_fixture_never_persist');
  await page.getByRole('button',{name:'加载团队空间'}).click();
  await expect(page.getByLabel('团队空间',{exact:true})).toHaveValue('f1000000-0000-4000-8000-000000000001');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('ato_v1_fixture_never_persist');
  await page.reload();
  await page.getByRole('button',{name:'测试运行',exact:true}).click();
  await expect(page.getByLabel('Bearer Token',{exact:true})).toHaveValue('');
});
test('one-time Token result clears the fragment and survives React strict initialization',async({page})=>{
  await page.goto('/openapi/token#token=ato_v1_fixture_only');
  await expect(page.locator('.open-secret')).toHaveText('ato_v1_fixture_only');
  await expect(page).toHaveURL(/\/openapi\/token$/);
  await page.getByRole('button',{name:'已保存，隐藏 Token'}).click();
  await expect(page.locator('.open-secret')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.open-secret')).toHaveCount(0);
});
