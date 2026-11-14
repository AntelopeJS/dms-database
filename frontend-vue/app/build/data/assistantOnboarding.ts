/**
 * What dms-assistant offers the rest of the app, mirrored here so the module
 * depends on its shape only: `isAvailable` is false while the assistant
 * cannot take the user through a step.
 */
export interface PublicOnboarding {
	readonly isAvailable: boolean
	open(step?: 'connect-database'): void
}

/** The key dms-assistant provides its onboarding under, app-wide. */
export const ONBOARDING_KEY = Symbol.for('dms-assistant:onboarding')
