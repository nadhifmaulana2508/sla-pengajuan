export const DEFAULT_SLA_MINUTES = 7 * 24 * 60;
export const SLA_WARNING_MINUTES = 3 * 24 * 60;

export type SlaStatus = 'safe' | 'warning' | 'overdue';

/** MVP thresholds: green below three days, yellow from three through seven, red after seven. */
export function getSlaStatus(elapsedSeconds: number, targetMinutes = DEFAULT_SLA_MINUTES): SlaStatus {
	const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
	const targetSeconds = Math.max(1, Number(targetMinutes) || DEFAULT_SLA_MINUTES) * 60;
	const warningSeconds = Math.min(SLA_WARNING_MINUTES * 60, targetSeconds);
	if (elapsed > targetSeconds) return 'overdue';
	if (elapsed >= warningSeconds) return 'warning';
	return 'safe';
}
