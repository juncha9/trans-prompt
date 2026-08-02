
/** Check if a line is a comment (//, #, or inside a multi-line comment) */
function isComment(trimmed: string, inBlockComment: boolean): boolean {
	if (inBlockComment) { return true; }
	return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*');
}

/** Group lines into paragraphs (blocks of non-empty lines), skipping code blocks but keeping comments */
export function parseParagraphs(lines: string[]): number[][] {
	const paragraphs: number[][] = [];
	let current: number[] = [];
	let inCodeBlock = false;
	let inBlockComment = false;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith('```')) {
			if (current.length > 0) {
				paragraphs.push(current);
				current = [];
			}
			if (inCodeBlock == true) {
				inCodeBlock = false;
				inBlockComment = false;
			} else {
				inCodeBlock = true;
			}
			continue;
		}
		if (inCodeBlock == true) {
			if (inBlockComment == false && trimmed.startsWith('/*')) {
				inBlockComment = true;
			}
			if (isComment(trimmed, inBlockComment) == true) {
				current.push(i);
			} else if (current.length > 0) {
				paragraphs.push(current);
				current = [];
			}
			if (inBlockComment == true && trimmed.endsWith('*/')) {
				inBlockComment = false;
			}
			continue;
		}
		if (trimmed.length > 0) {
			current.push(i);
		} else if (current.length > 0) {
			paragraphs.push(current);
			current = [];
		}
	}
	if (current.length > 0) {
		paragraphs.push(current);
	}
	return paragraphs;
}

