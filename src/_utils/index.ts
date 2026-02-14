
/** Calculate display width of a string (CJK/fullwidth chars count as 2, others as 1) */
export function getDisplayWidth(str: string): number {
	let width = 0;
	for (const char of str) {
		const code = char.codePointAt(0)!;
		if (
			(code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
			(code >= 0x2E80 && code <= 0x303E) ||  // CJK Radicals, Kangxi, Ideographic
			(code >= 0x3040 && code <= 0x33BF) ||  // Hiragana, Katakana, CJK Compatibility
			(code >= 0x3400 && code <= 0x4DBF) ||  // CJK Unified Ext A
			(code >= 0x4E00 && code <= 0xA4CF) ||  // CJK Unified, Yi
			(code >= 0xA960 && code <= 0xA97C) ||  // Hangul Jamo Extended-A
			(code >= 0xAC00 && code <= 0xD7AF) ||  // Hangul Syllables
			(code >= 0xD7B0 && code <= 0xD7FF) ||  // Hangul Jamo Extended-B
			(code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility Ideographs
			(code >= 0xFE30 && code <= 0xFE6F) ||  // CJK Compatibility Forms
			(code >= 0xFF01 && code <= 0xFF60) ||  // Fullwidth Forms
			(code >= 0xFFE0 && code <= 0xFFE6) ||  // Fullwidth Signs
			(code >= 0x20000 && code <= 0x2FA1F)   // CJK Unified Ext B-F, Compatibility Supplement
		) {
			width += 2;
		} else {
			width += 1;
		}
	}
	return width;
}
