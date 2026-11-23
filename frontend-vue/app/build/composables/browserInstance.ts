import { CROSS_INSTANCE_SENTINEL } from '../utils/stagedSerialization'

/**
 * A tab's instance as its id and the browse routes' `filter_instance` carry
 * it: this value for the default instance, `CROSS_INSTANCE_VALUE`, or a named
 * instance id.
 */
export const DEFAULT_INSTANCE_VALUE = '__DEFAULT__'

/** The instance value of a tab that reads every instance at once. */
export const CROSS_INSTANCE_VALUE = CROSS_INSTANCE_SENTINEL
