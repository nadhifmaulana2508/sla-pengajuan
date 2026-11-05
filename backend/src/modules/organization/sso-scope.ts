type SsoOrganizationProfile = {
	unit_kerja?: string | null;
	branch_name?: string | null;
	job_position?: string | null;
};

export function normalizeSsoUnitName(value: string | null | undefined): string | null {
	const normalized = value?.trim()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^divisi\s+/i, '')
		.trim()
		.toLocaleLowerCase('id-ID');
	return normalized || null;
}

const korwilAliases: Record<string, string[]> = {
	semarang: ['semarang'],
	solo: ['solo', 'surakarta'],
	banyumas: ['banyumas', 'purwokerto'],
	pekalongan: ['pekalongan']
};

export function inferKorwilFromSsoText(
	profile: SsoOrganizationProfile,
	knownKorwils: string[]
): string | null {
	const text = `${profile.unit_kerja ?? ''} ${profile.branch_name ?? ''} ${profile.job_position ?? ''}`
		.toLocaleLowerCase('id-ID')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '');
	const matches = new Set<string>();

	for (const korwil of knownKorwils) {
		const aliases = korwilAliases[korwil] ?? [korwil];
		if (aliases.some((alias) => text.includes(alias))) matches.add(korwil);
	}

	return matches.size === 1 ? [...matches][0] ?? null : null;
}
