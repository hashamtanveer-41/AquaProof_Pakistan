/**
 * Story configuration for the AquaProof Pakistan landing page.
 *
 * DEMO_URL: set to the deployed dashboard URL. Until then, the story links
 * to the product overview.
 *
 * CONTACT_URL: optional mailto: or web link for the team. Hidden while null.
 */
export const DEMO_URL: string | null = 'https://aqua-proof-pakistan-sage.vercel.app/'
export const CONTACT_URL: string | null = null
export const REPO_URL = 'https://github.com/hashamtanveer-41/AquaProof_Pakistan'
export const GROUNDWATER_SOURCE = 'https://www.worldbank.org/en/news/feature/2021/03/25/managing-groundwater-resources-in-pakistan-indus-basin'

/** All values below are illustrative sample data, not live readings. */
export const SAMPLE = {
  greenStage: 'Tillering',
  goldenStage: 'Nearing maturity',
  greenForecast: 'Rain likely tomorrow',
  goldenForecast: 'Rain possible this week',
  canalTurn: 'Canal turn: Thursday',
}

/** Example WhatsApp advisories in Urdu with English translations. */
export const ADVISORY_PUMP = {
  ur: 'کل بارش کا امکان ہے۔ آج ٹیوب ویل نہ چلائیں۔ بارش کے بعد کھیت دیکھیں کہ نہری باری پر پانی کی ضرورت ہے یا نہیں۔',
  en: 'Rain is likely tomorrow. Hold off pumping today. After the rain, check whether the field still needs water at your canal turn.',
}

export const ADVISORY_HARVEST = {
  ur: 'بارش کا امکان ہے۔ اپنی گندم چیک کریں۔ اگر فصل پک چکی ہے تو بارش سے پہلے کٹائی پر غور کریں۔',
  en: 'Rain is possible. Check your wheat. If it’s ready, consider harvesting before the rain.',
}

/** The farmer's reply in Roman Urdu, and what the AI Advisory Center reads from it. */
export const FARMER_REPLY = {
  text: '12 February 2026 ko nehar se 2 ghantay pani diya.',
  en: 'I irrigated with canal water for two hours on 12 February 2026.',
  parsed: [
    ['Source', 'Canal'],
    ['Duration', '120 minutes'],
    ['Date', '12 Feb 2026'],
  ] as [string, string][],
}
