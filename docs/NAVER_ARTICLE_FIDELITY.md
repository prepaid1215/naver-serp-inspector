# Naver Article Fidelity Audit v2.1.2

## Finding

The live 396요금제 research run #3 extracted a 2,252-character Naver Blog article and a 253-character Naver Cafe article. Neither length proves that the complete original page was captured. The Blog result contained standalone 'AI 활용' labels, and centered table values were incorrectly tagged as headings.

## Changes

- Preserve the observed rendered text in data.text.
- Separately store data.clean_text, dropping only standalone Naver AI disclosure labels and zero-width characters. Link preview text remains available.
- Recognize numbered section heading candidates while excluding table cells.
- Preserve image count, alt labels, available image captions, and extraction_audit metadata.
- Explicitly mark full-original comparison as not_verified and image OCR as false.
- Keep capture and export limits consistent at 60,000 characters.

## Tests and limitations

Offline Chromium tests reproduce numbered sections, an aligned table, disclosure labels, and image captions. They validate structure extraction and export filtering. They DO NOT establish exact fidelity to a live Naver page; the assistant's direct web access to the linked original articles was blocked.

Old v2.1.1 records remain unchanged. New v2.1.2 browser captures create new records. Article completeness must still be checked against a rendered original page before making definitive claims.
