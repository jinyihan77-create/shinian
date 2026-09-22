export type SpeechResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
};

function joinText(parts: string[]) {
  return parts.map(part => part.trim()).filter(Boolean).join(" ");
}

/** Rebuild one recognition session from the browser's complete result list. */
export function composeSpeechInput(baseText: string, results: ArrayLike<SpeechResultLike>) {
  const finalParts: string[] = [];
  const interimParts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const transcript = result?.[0]?.transcript?.trim() ?? "";
    if (!transcript) continue;
    (result.isFinal ? finalParts : interimParts).push(transcript);
  }
  return joinText([baseText, ...finalParts, ...interimParts]);
}
