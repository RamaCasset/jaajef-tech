# Code runner (E2B): setup guide (plain language)

When a member clicks "Lancer les tests", their code is graded on the server. Two small
programs do it:

- `run-quest` checks who the member is, applies the run limit, and records the result.
- `e2b-runner` runs the code inside E2B, a rented, sealed-off computer that is destroyed
  afterwards, and says which tests passed.

You do this once. One step at a time. Never paste a secret into a chat, an email or the
GitHub repository.

## What you need first
- All the migration files have been run, including the "entry point" one.
- The `run-quest` and `e2b-runner` folders under `supabase/functions` in this repository.

## Step 1. Make an E2B account and a key
1. Go to e2b.dev and sign up. New accounts get free starting credits.
2. In the E2B dashboard, find API keys and create one. Copy it. Keep it in your password
   manager.

## Step 2. Invent the runner's password
Make up a long random text of at least 20 characters. This is the RUNNER_KEY. It is the
password `run-quest` uses to talk to `e2b-runner`, so nobody else can use your E2B credits.

## Step 3. Save the secrets in Supabase
Edge Functions, then Secrets. Add:

1. `E2B_API_KEY`: the E2B key.
2. `RUNNER_KEY`: your made-up password.
3. `RUNNER_URL`: the address of `e2b-runner` (you get it in Step 4, so come back to this one).

## Step 4. Create the `e2b-runner` function
1. Edge Functions, then Deploy a new function, then Via Editor.
2. Replace everything with the contents of `index.ts` from `supabase/functions/e2b-runner`.
3. Deploy. Switch off JWT verification for it (it has its own password check).
4. Copy the function's address (it ends with a name Supabase chose, which may not match what
   you typed). Save it as the `RUNNER_URL` secret from Step 3.

## Step 5. Create the `run-quest` function
1. Same way: contents of `index.ts` from `supabase/functions/run-quest`.
2. Deploy. Switch off JWT verification (it checks the member's login itself).
3. Note its address too. Its name is also chosen by Supabase.

## Step 6. Try the runner by hand
1. Open the `e2b-runner` function, then Test.
2. Method POST. Add a header named `authorization` with the value `Bearer ` followed by your
   RUNNER_KEY (the word Bearer, a space, then the password).
3. Use this as the body:

```json
{
  "language": "python",
  "entry_point": "first_repeat",
  "code": "def first_repeat(values):\n    seen = set()\n    for v in values:\n        if v in seen:\n            return v\n        seen.add(v)\n    return None\n",
  "tests": [
    { "name": "repeat_middle", "input": [1, 2, 1, 3], "expected": 1 },
    { "name": "unique", "input": [1, 2, 3], "expected": null },
    { "name": "wrong_on_purpose", "input": [7, 7], "expected": 8 }
  ],
  "time_limit_ms": 5000
}
```

You should get `passed: true` for the first two and `passed: false` for the third. Also try a
wrong password: the answer must be "unauthorized".

The first call after a quiet period can take a few extra seconds while E2B starts the sandbox.

## Costs and limits
- E2B bills by the second of computer time. A run takes a few seconds.
- Each member can run 6 times a minute and 150 times a day (placeholders to confirm).
- The sandbox has no internet. Python and JavaScript are supported.

## How quests are graded (the rules)
- The quest names the function to write (`entry_point`).
- Each hidden test calls it with the test input as its only argument.
- What it returns must equal the expected value (compared as JSON).
- The expected values never enter the sandbox and are never sent to the member's browser.

## Honest limits
- The sandbox's own isolation is E2B's job, not ours.
- A determined member could try to guess hidden answers by running many times; the run limit
  slows this but cannot stop it.
