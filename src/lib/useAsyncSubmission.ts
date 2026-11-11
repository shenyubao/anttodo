import { useMutation, useMutationState, useQueryClient, type MutationKey, type QueryClient } from "@tanstack/react-query";

export type Submission = {
  operationId: string;
  userId: string;
  workspaceId: string;
  entityId: string;
};

export function assertSubmissionOnline() {
  if (!navigator.onLine) throw new Error("离线时不可提交，请联网后重试");
}

export function clearAsyncSubmissions(client: QueryClient, userId: string) {
  for (const mutation of client.getMutationCache().findAll({ mutationKey: ["async-submission", userId] })) {
    client.getMutationCache().remove(mutation);
  }
}

/** Mutation variables are the in-memory draft; only confirmed results enter queries. */
export function useAsyncSubmission<T extends Submission, R>(options: {
  mutationKey: MutationKey;
  online: boolean;
  submit: (input: T) => Promise<R>;
  onSuccess: (result: R, input: T) => Promise<void> | void;
  onError: (error: Error, input: T) => Promise<void> | void;
}) {
  const client = useQueryClient();
  const cache = client.getMutationCache();
  const mutation = useMutation({
    mutationKey: options.mutationKey,
    // Fail immediately, including the race between clicking and losing connectivity.
    // `online` mode would pause and automatically send the write on reconnect.
    networkMode: "always",
    retry: false,
    gcTime: Infinity,
    mutationFn: async (input: T) => {
      assertSubmissionOnline();
      return options.submit(input);
    },
    onSuccess: options.onSuccess,
    onError: options.onError,
    onSettled: (_result, error, input) => {
      if (error) return;
      // Successful entries no longer carry a draft; failed entries live until dismissed.
      for (const item of cache.findAll({ mutationKey: options.mutationKey, exact: true })) {
        if ((item.state.variables as T | undefined)?.operationId === input.operationId) cache.remove(item);
      }
    },
  });
  const states = useMutationState({
    filters: { mutationKey: options.mutationKey, exact: true },
    select: (item) => ({
      input: item.state.variables as T,
      status: item.state.status,
      error: item.state.error,
    }),
  });

  function dismiss(operationId: string) {
    for (const item of cache.findAll({ mutationKey: options.mutationKey, exact: true })) {
      if ((item.state.variables as T | undefined)?.operationId === operationId && item.state.status !== "pending") {
        cache.remove(item);
      }
    }
  }

  function submit(input: T) {
    if (!options.online) throw new Error("离线时不可提交，请联网后重试");
    assertSubmissionOnline();
    // Inspect the cache synchronously: React has not necessarily rendered a double click.
    const existing = cache.findAll({ mutationKey: options.mutationKey, exact: true });
    if (existing.some((item) => item.state.status === "pending"
      && (item.state.variables as T | undefined)?.entityId === input.entityId)) return false;
    for (const item of existing) {
      if ((item.state.variables as T | undefined)?.entityId === input.entityId) cache.remove(item);
    }
    mutation.mutate(input);
    return true;
  }

  return { submit, dismiss, states: states.filter((state) => state.input && state.status !== "success" && state.status !== "idle") };
}
