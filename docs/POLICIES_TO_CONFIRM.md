# Policies: what must be confirmed before launch

The four texts live in `app/src/i18n/legal.ts` (French and English) and are public pages:
Conditions `/conditions`, Confidentialité `/confidentialite`, Règles `/regles`, Règles des offres `/regles-offres`.
They are linked from the first screen, the About page and sign-up. Each page carries a "version provisoire" notice; remove it (in `legal.ts`, field `draft`) once a lawyer has approved the text.

## Fill in (search for `[À CONFIRMER` and `[TO CONFIRM` in `legal.ts`)
1. Legal name and address of the organisation that runs the site.
2. A contact e-mail for privacy questions (wait for the domain).
3. Whether a declaration to the CDP (Senegal data protection authority, law no. 2008-12) is needed, and its number.
4. Minimum age (the draft says 16).
5. How long technical logs are kept.
6. Refund policy for Kopeks.
7. Competent court.
8. The e-mail sending service, once chosen.
9. Where Supabase data is stored (region), if the lawyer wants it stated.

## Have a lawyer check
- Senegalese data protection law and cross-border transfers (Supabase, Vercel, E2B, PayDunya are outside Senegal).
- Cookies / browser storage wording (we only use sign-in, language and theme).
- Job rules: the platform is not a party to hiring contracts.
- That the 14-day deletion wait and the statement "we keep only an anonymous trace" are correct for the law.

## Keep true
The privacy text states what the app does today: no card numbers kept, no ads, no sale of data, private messages private, applications visible only to the offer owner, deletion after 14 days, data download. If a feature changes any of that, change the text first.
