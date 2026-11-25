const encoder = new TextEncoder();

const crcTable = new Uint32Array(256);
for (let value = 0; value < crcTable.length; value += 1) {
	let remainder = value;
	for (let bit = 0; bit < 8; bit += 1) {
		remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
	}
	crcTable[value] = remainder >>> 0;
}

function crc32(bytes: Uint8Array): number {
	let checksum = 0xffffffff;
	for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
	return (checksum ^ 0xffffffff) >>> 0;
}

function littleEndian16(value: number): number[] {
	return [value & 0xff, (value >>> 8) & 0xff];
}

function littleEndian32(value: number): number[] {
	return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function escapeXml(value: string): string {
	return value
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function columnName(index: number): string {
	let value = index + 1;
	let result = '';
	while (value > 0) {
		const remainder = (value - 1) % 26;
		result = String.fromCharCode(65 + remainder) + result;
		value = Math.floor((value - 1) / 26);
	}
	return result;
}

function worksheetXml(rows: readonly (readonly string[])[]): string {
	const sheetRows = rows.map((row, rowIndex) => {
		const cells = row.map((value, columnIndex) => {
			const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
			return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
		}).join('');
		return `<row r="${rowIndex + 1}">${cells}</row>`;
	}).join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
}

function storedZip(files: readonly { name: string; contents: string }[]): Uint8Array {
	const localParts: Uint8Array[] = [];
	const directoryParts: Uint8Array[] = [];
	let localOffset = 0;

	for (const file of files) {
		const name = encoder.encode(file.name);
		const contents = encoder.encode(file.contents);
		const checksum = crc32(contents);
		const localHeader = new Uint8Array([
			...littleEndian32(0x04034b50), ...littleEndian16(20), ...littleEndian16(0x0800),
			...littleEndian16(0), ...littleEndian16(0), ...littleEndian16(0x0021),
			...littleEndian32(checksum), ...littleEndian32(contents.length), ...littleEndian32(contents.length),
			...littleEndian16(name.length), ...littleEndian16(0)
		]);
		localParts.push(localHeader, name, contents);

		const directoryHeader = new Uint8Array([
			...littleEndian32(0x02014b50), ...littleEndian16(20), ...littleEndian16(20), ...littleEndian16(0x0800),
			...littleEndian16(0), ...littleEndian16(0), ...littleEndian16(0x0021),
			...littleEndian32(checksum), ...littleEndian32(contents.length), ...littleEndian32(contents.length),
			...littleEndian16(name.length), ...littleEndian16(0), ...littleEndian16(0), ...littleEndian16(0),
			...littleEndian16(0), ...littleEndian32(0), ...littleEndian32(localOffset)
		]);
		directoryParts.push(directoryHeader, name);
		localOffset += localHeader.length + name.length + contents.length;
	}

	const directory = concatBytes(directoryParts);
	const endRecord = new Uint8Array([
		...littleEndian32(0x06054b50), ...littleEndian16(0), ...littleEndian16(0),
		...littleEndian16(files.length), ...littleEndian16(files.length),
		...littleEndian32(directory.length), ...littleEndian32(localOffset), ...littleEndian16(0)
	]);
	return concatBytes([...localParts, directory, endRecord]);
}

export function buildXlsxWorkbook(rows: readonly (readonly string[])[]): Uint8Array {
	const files = [
		{
			name: '[Content_Types].xml',
			contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
		},
		{
			name: '_rels/.rels',
			contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
		},
		{
			name: 'xl/workbook.xml',
			contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data Rekening" sheetId="1" r:id="rId1"/></sheets></workbook>'
		},
		{
			name: 'xl/_rels/workbook.xml.rels',
			contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
		},
		{ name: 'xl/worksheets/sheet1.xml', contents: worksheetXml(rows) }
	];
	return storedZip(files);
}
