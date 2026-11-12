const wibDateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'Asia/Jakarta',
	timeZoneName: 'short'
});

export function formatDateTimeWib(value: string | Date): string {
	return wibDateTimeFormatter.format(new Date(value));
}
