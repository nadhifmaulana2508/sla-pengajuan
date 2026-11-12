import { z } from 'zod';

export const formFieldTypeSchema = z.enum(['text', 'textarea', 'number', 'currency', 'date', 'select']);
export const repeatableFormSchema = z.object({
	label: z.string().trim().min(1).max(80),
	max_entries: z.number().int().min(2).max(20)
}).strict();

export const creditRoutingSchema = z.object({
	marketing_threshold_amount: z.number().int().safe().min(250_000_000)
}).strict();
export type CreditRoutingConfig = z.infer<typeof creditRoutingSchema>;
export const DEFAULT_CREDIT_ROUTING_CONFIG: CreditRoutingConfig = { marketing_threshold_amount: 500_000_000 };

const formFieldSchema = z.object({
	key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
	label: z.string().trim().min(1).max(160),
	type: formFieldTypeSchema,
	required: z.boolean(),
	options: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
	min_value: z.number().finite().optional(),
	max_value: z.number().finite().optional(),
	system: z.boolean().optional(),
	requires_korwil_review: z.boolean().optional()
}).strict().superRefine((field, context) => {
	if (field.type === 'select') {
		if (!field.options?.length) context.addIssue({ code: 'custom', message: 'Pilihan wajib diisi untuk field bertipe pilihan.', path: ['options'] });
		if (field.options && new Set(field.options.map((item) => item.toLocaleLowerCase('id-ID'))).size !== field.options.length) {
			context.addIssue({ code: 'custom', message: 'Pilihan tidak boleh berulang.', path: ['options'] });
		}
	} else if (field.options?.length) {
		context.addIssue({ code: 'custom', message: 'Pilihan hanya berlaku untuk field bertipe pilihan.', path: ['options'] });
	}
	if (field.min_value !== undefined && field.max_value !== undefined && field.min_value > field.max_value) {
		context.addIssue({ code: 'custom', message: 'Nilai minimum tidak boleh lebih besar dari maksimum.', path: ['min_value'] });
	}
});

export const formDefinitionSchema = z.object({
	fields: z.array(formFieldSchema).max(40),
	repeatable: repeatableFormSchema.optional(),
	credit_routing: creditRoutingSchema.optional()
}).strict().superRefine((definition, context) => {
	const keys = definition.fields.map((field) => field.key);
	if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Kunci field harus unik.', path: ['fields'] });
	if (definition.repeatable && definition.fields.length === 0) {
		context.addIssue({ code: 'custom', message: 'Form berulang harus memiliki sedikitnya satu kolom.', path: ['repeatable'] });
	}
});

export type FormFieldDefinition = z.infer<typeof formFieldSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type RepeatableFormConfig = z.infer<typeof repeatableFormSchema>;
export type FormAnswerRow = Record<string, string | number>;
export const REPEATABLE_FORM_ANSWERS_KEY = '__entries';
export type ValidatedFormAnswers = FormAnswerRow | { [REPEATABLE_FORM_ANSWERS_KEY]: FormAnswerRow[] };

export function parseFormDefinition(value: unknown): FormDefinition {
	let decoded = value;
	if (typeof value === 'string') {
		try {
			decoded = JSON.parse(value) as unknown;
		} catch {
			return { fields: [] };
		}
	}
	const parsed = formDefinitionSchema.safeParse(decoded);
	return parsed.success ? parsed.data : { fields: [] };
}

function validateSingleFormAnswers(fields: FormFieldDefinition[], input: Record<string, unknown>): FormAnswerRow {
	const allowedKeys = new Set(fields.map((field) => field.key));
	const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
	if (unknownKey) throw new Error('Ada isian form yang sudah tidak berlaku. Muat ulang form sebelum mengirim.');

	const answers: FormAnswerRow = {};
	for (const field of fields) {
		const raw = input[field.key];
		const value = typeof raw === 'string' ? raw.trim() : raw;
		const empty = value === undefined || value === null || value === '';
		if (empty) {
			if (field.required) throw new Error(`Field “${field.label}” wajib diisi.`);
			continue;
		}

		if (field.type === 'text' || field.type === 'textarea') {
			if (typeof value !== 'string' || value.length > (field.type === 'textarea' ? 5000 : 1000)) {
				throw new Error(`Isi “${field.label}” terlalu panjang atau tidak valid.`);
			}
			answers[field.key] = value;
			continue;
		}

		if (field.type === 'select') {
			if (typeof value !== 'string' || !field.options?.includes(value)) throw new Error(`Pilih salah satu opsi untuk “${field.label}”.`);
			answers[field.key] = value;
			continue;
		}

		if (field.type === 'date') {
			if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
				throw new Error(`Tanggal “${field.label}” belum valid.`);
			}
			answers[field.key] = value;
			continue;
		}

		const numericValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
		if (!Number.isFinite(numericValue) || (field.type === 'currency' && !Number.isSafeInteger(numericValue))) {
			throw new Error(`Masukkan angka yang valid untuk “${field.label}”.`);
		}
		if (field.min_value !== undefined && numericValue < field.min_value) {
			const minimum = field.type === 'currency' ? `Rp${new Intl.NumberFormat('id-ID').format(field.min_value)}` : String(field.min_value);
			throw new Error(`“${field.label}” minimal ${minimum}.`);
		}
		if (field.max_value !== undefined && numericValue > field.max_value) throw new Error(`“${field.label}” melebihi nilai maksimum.`);
		answers[field.key] = numericValue;
	}
	return answers;
}

export function validateFormAnswers(definition: FormDefinition, input: Record<string, unknown>): ValidatedFormAnswers {
	if (!definition.repeatable) return validateSingleFormAnswers(definition.fields, input);
	const unknownKey = Object.keys(input).find((key) => key !== REPEATABLE_FORM_ANSWERS_KEY);
	if (unknownKey) throw new Error('Data form berulang tidak sesuai versi form. Muat ulang form sebelum mengirim.');
	const rawEntries = input[REPEATABLE_FORM_ANSWERS_KEY];
	if (!Array.isArray(rawEntries) || rawEntries.length < 1 || rawEntries.length > definition.repeatable.max_entries) {
		throw new Error(`Tambahkan antara 1 sampai ${definition.repeatable.max_entries} ${definition.repeatable.label.toLocaleLowerCase('id-ID')}.`);
	}
	const entries = rawEntries.map((entry, index) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error(`Data ke-${index + 1} pada form tidak valid.`);
		}
		const values = Object.values(entry as Record<string, unknown>);
		if (!values.some((value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === ''))) {
			throw new Error(`Isi sedikitnya satu kolom pada ${definition.repeatable!.label.toLocaleLowerCase('id-ID')} ke-${index + 1}.`);
		}
		return validateSingleFormAnswers(definition.fields, entry as Record<string, unknown>);
	});
	return { [REPEATABLE_FORM_ANSWERS_KEY]: entries };
}
