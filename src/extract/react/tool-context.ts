// How a tool's React cards reach the tool's shared context (`rctx`, `mctx`). Cards are mounted with no props, so
// the tool's setup registers its context here before they mount (tests register a fake one). The context never
// changes once set, so reading it needs no subscription: cards re-render through useWorkspace.
export function createToolContext<T>(setupName: string) {
  let current: T | null = null;
  return {
    set(ctx: T | null) {
      current = ctx;
    },
    /** The registered context; throws when the tool's setup has not run. */
    get(): T {
      if (!current) throw new Error(`${setupName} has not run`);
      return current;
    },
  };
}
