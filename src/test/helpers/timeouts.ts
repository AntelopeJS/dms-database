/** Budget for a test or hook that talks to the in-memory MongoDB and the booted DMS on a host that is busy or slow. */
export const LOADED_HOST_TIMEOUT_MS = 30_000;

/** Budget for a hook that seeds a fixture, which also waits on the first DMS boot and MongoDB download on a slow runner. */
export const SEED_HOOK_TIMEOUT_MS = 120_000;
