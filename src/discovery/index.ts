export {
  createSelectorCache,
  type SelectorCacheImpl,
  type SelectorCacheOptions,
  type SetPayload,
} from './cache';
export {
  createDiscoveryEngine,
  type DiscoveryEngineDeps,
  type DiscoveryEngineImpl,
  type ResolveOptions,
} from './engine';
export { type SelectorMap, selectorsFor, substringFragmentsFor } from './selectors';
export {
  type CacheEntry,
  type DiscoveryMetrics,
  type DiscoverySource,
  type ResolveResult,
  SELECTOR_KEYS,
  type SelectorKey,
  type ValidationResult,
  type Validator,
} from './types';
export { Validators } from './validators';
