# PizzaPal Bot

A chat-based pizza ordering prototype. Instead of filling in a form, the customer talks to a bot that asks for the size, crust, toppings and delivery address one step at a time.

**Live demo:** https://mankomalg.github.io/pizzaBot/

Built for **BTH745 – Human-Computer Interaction** (Seneca Polytechnic) as the *conversational interface* prototype in a study of five different ways to order the same pizza.

---

## Why this exists

The course project compares five interaction paradigms for one task, ordering a customised pizza for delivery. This repository is the conversational one.

| | |
|---|---|
| **Paradigm** | Conversational interface (natural-language flow) |
| **Good for** | People used to messaging apps, and anyone who prefers to be guided step by step |
| **Trade-off** | Needs sensible handling of unexpected input, and is slower than a form for someone who knows exactly what they want |

The prototype is built to be tested with real users. It is not a real ordering system.

## What it does

- **Guided order flow:** size, crust, toppings, name, delivery address, then an order summary to confirm or modify, then payment.
- **Quick-reply buttons or typing:** size and crust can be tapped or typed ("large", "thin and crispy"). Anything the bot can't understand gets a clear error and the question is asked again.
- **Live address lookup:** while the customer types, the bot suggests real Brampton addresses (Geoapify autocomplete) and they tap one. Without a key, or if the service is slow or down, the bot silently uses the built-in list of 50 fictional addresses. Anything outside Brampton gets *"Sorry, that's not a valid address in our Brampton delivery area"*, and typos get a "Did you mean…?" suggestion.
- **Several answers in one message:** "large thin crust with pepperoni and mushrooms, my name is Sam" fills in every answer the bot can read, then asks only for what is missing. Screens answered ahead of time still count as visited in the usability log.
- **Back, Help and My order:** buttons under the chat (or type `back`, `help`, `my order`, `start over`) let the customer undo the last answer, get tips for the current question, or see the order so far.
- **Realistic totals:** pizza price, a $2.99 delivery fee, 13% Ontario HST on both, and an optional driver tip (No tip, 10%, 15%, 20%) on the payment screen.
- **Topping pricing:** the first 3 toppings are included. Each extra topping costs more, and premium toppings (marked ★) cost double. The extra charge updates live and appears in the summary.
- **Mock payment:** after confirming the summary the customer chooses *Pay by card* or *Pay on delivery*. The card form accepts any 16-digit number, any future MM/YY expiry and any 3-digit code. Nothing is charged, sent or stored.
- **Order memory (optional):** with `?memory` on the address the bot remembers the last customer in that browser and offers "Welcome back, reorder?". Off by default because test browsers are shared.
- **Modify before confirming:** change the size, crust, toppings or address without starting over.
- **Built-in usability logging:** every run is recorded automatically (completion, time, errors, steps visited). Participants never see this. Add `?tester` to the address to open the tester tools: results table, spreadsheet copy, CSV and JSON downloads, the list of built-in addresses and a Restart button.
- **Accessible:** works with a keyboard and screen reader (labelled controls, live announcements, visible focus), meets AA colour contrast, and is responsive in light and dark mode.

## Ordering rules

| Item | Price (CAD) |
|---|---|
| Small / Medium / Large | $8.99 / $11.99 / $14.99 |
| Gluten-Free crust | +$1.50 (Hand-Tossed and Thin & Crispy are free) |
| First 3 toppings | Included |
| Each extra topping | +$0.30 |
| Each extra premium topping (★) | +$0.60 |
| Delivery fee | $2.99 |
| HST | 13% of pizza + delivery fee (tip is not taxed) |

- 17 toppings to choose from. Premium: Extra Cheese, Feta, Mushroom, Bacon, Chicken, Artichokes.
- Extra charges apply to toppings in the order they were picked, after the first 3.
- Extra Cheese is not available on Large pizzas.
- Typing `cancel` cancels the order. Typing `reset` clears the pizza choices but keeps the address.
- Page options: `?tester` (tester tools), `?memory` (order memory), `?local` (skip live address lookup).

## Address lookup

`js/config.js` holds the Geoapify key. With a key, suggestions come from Geoapify, limited to Brampton, ON. Create a free key (no card) at myprojects.geoapify.com and paste it into `geoapifyKey`. Because the page is public the key is visible, so restrict it to your site's address in the Geoapify dashboard.

Without a key (or with `?local`, or when the service fails) `js/addresses.js` is used: **50 fictional Brampton addresses** and a small checker that ignores capitalisation and punctuation, treats `St`/`Street` and `N`/`North` as the same, and suggests the closest address within a couple of typos. House numbers and postal codes there are made up.

## Running it

No install or build step.

1. Download or clone this repository.
2. Open `index.html` in any browser.

To publish it, use GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

## Project structure

```
index.html        Page structure
js/config.js      Settings (Geoapify key)
css/style.css     Styling, responsive layout, light and dark theme
js/addresses.js   Built-in fallback: the 50 addresses and the address checker
js/app.js         Chat flow, topping pricing, order summary, error handling, usability logging and tester tools
```

## Changing things

| To change | Edit |
|---|---|
| Valid addresses | `ROWS` list in `js/addresses.js` |
| Included toppings and extra prices | `INCLUDED_TOPPINGS`, `EXTRA_STANDARD`, `EXTRA_PREMIUM` at the top of `js/app.js` |
| Toppings and which are premium | `TOPPINGS` and `PREMIUM_TOPPINGS` in `js/app.js` |
| Sizes and crusts | `SIZES` and `CRUSTS` in `js/app.js` |

## Running a usability test

Participants open the normal address. The tester opens the same site in another tab of the **same browser** with `?tester` on the end, for example `https://mankomalg.github.io/pizzaBot/?tester`.

1. Give the participant the plain address (no `?tester`) and the task, for example: *order a large pizza with three toppings for delivery to 25 Main St N.*
2. They complete the order. The bot saves one row when the order is placed. If they cancel, restart or leave the page before that, the row is saved as not completed.
3. For the next participant, reload the page.
4. In the tester tab tap **Tester**. The **Results** tab shows one row per participant. Fill in **Nat.** (perceived naturalness, 1 to 5) and **Notes** after asking the participant.
5. Tap **Copy for spreadsheet**, click cell A2 in the results spreadsheet and paste. Or tap **Download CSV**, which also has extra columns (taps, typing, Back/Help use, error types, address lookup time and seconds per step). **Download JSON** gives every run with its full event log.

**What each column means**

| Column | Meaning |
|---|---|
| Done | 1 if the order was placed, otherwise 0 |
| Time | Seconds from the first tap or message until the order is placed (after payment). Capped at 300; 300 if not completed |
| Errors | Red error messages shown, capped at 10 |
| S | Steps visited, repeats included (a question answered ahead in one message still counts) |
| N | Different steps visited |
| R | Fewest steps needed to finish (8: size, crust, toppings, name, address, apartment, summary, payment) |
| Lost | Lostness = √((N/S − 1)² + (R/N − 1)²). 0 is best |

**Good to know**

- Results are saved in the browser that ran the session, so run all participants in the same browser. Clearing site data deletes them. Download the CSV after each testing session as a backup.
- Practice runs are logged too. Delete them with ✕ (tap twice) or **Clear results** before the real sessions.
- Time starts at the first tap or message, not when the page loads, so reading the greeting is not counted.
- Version 2 results use a separate store from earlier versions. Do not mix them with runs from before this version.
- The tester tab also shows live counts for the current run (bot turns, errors, invalid addresses, S and N).

## Limitations

- Prototype only. Confirming an order shows a made-up order number and delivery time. Payment is a mock: nothing is charged and nothing is sent to a server. The only thing stored is the usability log, in the browser's own storage.
- Understanding is simple keyword matching, not real language understanding. There is no voice input.
- Addresses must be in Brampton. Live lookup needs an internet connection and a Geoapify key.

## Tech

HTML, CSS and plain JavaScript. No frameworks, libraries or build tools. Fonts (Baloo 2 and Figtree) load from Google Fonts, and the page falls back to system fonts when offline.

## Author

Mankomal Kaur Gandhara, BTH745 Human-Computer Interaction, Seneca Polytechnic.