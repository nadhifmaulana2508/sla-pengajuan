const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 60;

function formatDate(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function getDefaultDateRange(now = new Date()): { from: string; to: string } {
	const dateParts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? '';
	const today = Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')));

	return {
		from: formatDate(new Date(today - (DEFAULT_RANGE_DAYS - 1) * DAY_IN_MILLISECONDS)),
		to: formatDate(new Date(today))
	};
}
