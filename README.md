# PizzaPal Bot

A chat-based pizza ordering prototype. Instead of filling in a form, the customer talks to a bot that asks for the size, crust, toppings and delivery address one step at a time.

**Live demo:** https://komal2106.github.io/PizzaPalBot/

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

- **Guided order flow:** size, crust, toppings, name, delivery address, then an order summary to confirm or modify.
- **Quick-reply buttons or typing:** size and crust can be tapped or typed ("large", "thin and crispy"). Anything the bot can't understand gets a clear error and the question is asked again.
- **Address checking:** the bot accepts only delivery addresses it knows. Anything else gets *"Sorry, that's not a valid address in our Brampton delivery area"* and the question is asked again. Typos get a "Did you mean…?" suggestion, and the city and postal code are filled in automatically once the address is found.
- **Address picker:** under the address question the bot lists the 50 valid test addresses as tappable buttons, so participants don't need to be told which ones work. They can still type their own. Set `SHOW_ADDRESS_PICKER` to `false` at the top of `js/app.js` to hide the list.
- **Topping pricing:** the first 3 toppings are included. Each extra topping costs more, and premium toppings (marked ★) cost double. The extra charge updates live and appears in the summary.
- **Modify before confirming:** change the size, crust, toppings or address without starting over.
- **Built-in usability logging:** every run is recorded automatically (completion, time, errors, steps visited). Participants never see this. Add `?tester` to the address to open the tester tools: results table, spreadsheet copy, CSV download, the list of valid addresses and a Restart button.
- **Responsive:** works on phones, tablets and desktop, in light and dark mode.

## Ordering rules

| Item | Price (CAD) |
|---|---|
| Small / Medium / Large | $8.99 / $11.99 / $14.99 |
| Gluten-Free crust | +$1.50 (Hand-Tossed and Thin & Crispy are free) |
| First 3 toppings | Included |
| Each extra topping | +$0.30 |
| Each extra premium topping (★) | +$0.60 |

- 17 toppings to choose from. Premium: Extra Cheese, Feta, Mushroom, Bacon, Chicken, Artichokes.
- Extra charges apply to toppings in the order they were picked, after the first 3.
- Extra Cheese is not available on Large pizzas.
- Typing `cancel` cancels the order. Typing `reset` clears the pizza choices but keeps the address.

## Address checking (the mock backend)

There is no server. `js/addresses.js` holds **50 fictional addresses in Brampton, ON** and a small checker that:

- ignores capitalisation, punctuation and extras like "Brampton, ON" or a postal code
- treats `St`/`Street`, `N`/`North` and similar as the same thing
- suggests the closest address when the input is within a couple of typos

The street names are real Brampton streets, but the house numbers and postal codes are made up for testing.

## Running it

No install or build step.

1. Download or clone this repository.
2. Open `index.html` in any browser.

To publish it, use GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

## Project structure

```
index.html        Page structure
css/style.css     Styling, responsive layout, light and dark theme
js/addresses.js   Mock backend: the 50 valid addresses and the address checker
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

Participants open the normal address. The tester opens the same site in another tab of the **same browser** with `?tester` on the end, for example `https://komal2106.github.io/PizzaPalBot/?tester`.

1. Give the participant the plain address (no `?tester`) and the task, for example: *order a large pizza with three toppings for delivery to 25 Main St N.*
2. They complete the order. The bot saves one row when the order is placed. If they cancel, restart or leave the page before that, the row is saved as not completed.
3. For the next participant, reload the page.
4. In the tester tab tap **Tester**. The **Results** tab shows one row per participant. Fill in **Nat.** (perceived naturalness, 1 to 5) and **Notes** after asking the participant.
5. Tap **Copy for spreadsheet**, click cell A2 in the results spreadsheet and paste. Or tap **Download CSV**.

**What each column means**

| Column | Meaning |
|---|---|
| Done | 1 if the order was placed, otherwise 0 |
| Time | Seconds from the first tap or message to tapping Confirm. Capped at 300; 300 if not completed |
| Errors | Red error messages shown, capped at 10 |
| S | Steps visited, repeats included |
| N | Different steps visited |
| R | Fewest steps needed to finish (7: size, crust, toppings, name, address, apartment, summary) |
| Lost | Lostness = √((N/S − 1)² + (R/N − 1)²). 0 is best |

**Good to know**

- Results are saved in the browser that ran the session, so run all participants in the same browser. Clearing site data deletes them. Download the CSV after each testing session as a backup.
- Practice runs are logged too. Delete them with ✕ (tap twice) or **Clear results** before the real sessions.
- Time starts at the first tap or message, not when the page loads, so reading the greeting is not counted.
- The tester tab also shows live counts for the current run (bot turns, errors, invalid addresses, S and N).

## Limitations

- Prototype only. Confirming an order shows a made-up order number and delivery time. There is no payment and nothing is sent to a server. The only thing stored is the usability log, in the browser's own storage.
- Understanding is simple keyword matching, not real language understanding. Toppings and the final confirmation use buttons.
- Only the 50 listed addresses are accepted.

## Tech

HTML, CSS and plain JavaScript. No frameworks, libraries or build tools. Fonts (Baloo 2 and Figtree) load from Google Fonts, and the page falls back to system fonts when offline.

## Author

Mankomal Kaur Gandhara, BTH745 Human-Computer Interaction, Seneca Polytechnic.