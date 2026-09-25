export function trackDeliveryIntro(options: 2 | 3, plural: boolean): string {
  const count = options === 2 ? "two" : "three";
  const noun = plural ? "music tracks" : "a music track";
  return `Choose one of these ${count} ways to deliver ${noun}.`;
}
