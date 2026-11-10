# Setting up PayDunya (Kopek purchases)

The code is finished. What is left is yours: an account, three keys, one function to deploy. About 15 minutes. Start in test mode: no real money moves.

## 1. Get the test keys
1. Create or open your PayDunya business account and create an application ("Intégrer mon API").
2. In the application page, switch to the **test** keys. You need three: the **master key**, the **private key** and the **token**. (The public key is not needed.)

Never paste these keys in chat, e-mail, GitHub or Vercel. They go only into Supabase, below.

## 2. Run the database file
In the Supabase SQL Editor, run the file `20261118130000_kopek_purchases.sql` from `supabase/migrations`. It creates the purchases table and the three server functions.

## 3. Put the keys into Supabase
Supabase, Edge Functions, Secrets. Add these five:

| Name | Value |
| --- | --- |
| `PAYDUNYA_MASTER_KEY` | your master key |
| `PAYDUNYA_PRIVATE_KEY` | your private key |
| `PAYDUNYA_TOKEN` | your token |
| `PAYDUNYA_MODE` | `test` |
| `SITE_URL` | the address of the website, no slash at the end (for example `https://jaajef-tech.vercel.app`) |

## 4. Deploy the function
Same way as the other functions, with one difference: PayDunya is not a signed-in member, so the door check is turned off for this function (the function checks sign-in itself):

`supabase functions deploy kopeks-payment --no-verify-jwt`

## 5. Test it
1. Sign in, open Le Souk, click "Acheter des Kopeks", choose the 100 pack, choose a method, click Pay.
2. You land on the PayDunya test page. Pay with the test numbers PayDunya gives in its test mode.
3. You come back to the site: "Merci ! 100 Kopeks ont été ajoutés". Check the Kopeks pill at the top.
4. Refresh the page and try the return link again: the balance must not grow a second time.

If a payment method does not show on the PayDunya page, tell Claude: the channel names (`wave-senegal`, `orange-money-senegal`, `card`) are the first thing to check.

## 6. Going live later
When the business account is validated by PayDunya: replace the three keys with the **live** keys and set `PAYDUNYA_MODE` to `live`. Nothing else changes. Test once with a small real payment.

## How it stays safe
- The price is worked out by the database from the pack list, never sent by the browser.
- Kopeks are credited only after the server asks PayDunya directly what happened, and only if the amount paid is the amount asked.
- Each purchase can be credited once, even if the browser and PayDunya both report it.
- A member sees only their own purchases. Members cannot call the crediting functions.
- Packs and the price per Kopek live in the `game_config` table (`kopek_packs`, `kopek_cfa_per_kopek`). The screen currently shows 100, 500 and 1 000; to change the packs, change both the table and the list in the Buy page.
