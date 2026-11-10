# Gatekeeper — entry form

Built for the Clocked Build Challenge 2026.

## Project name

Gatekeeper

## Overview

Gatekeeper is a safety airlock for people who put an assistant or agent in front of untrusted text: an inbound message, an email, a retrieved page, or a script the agent might run. The operator pastes the text or loads a sample. Gatekeeper asks Clocked to find personal data, judge prompt injection, and, when the text is a script, inspect the lines. It then makes one decision that changes what happens next.

A pass releases only the masked copy. A quarantine holds the text and paints the evidence in the source. An uncertain probability, a missing mask, or a failed check holds the text for a person. Nothing reaches the assistant until that call is made.

It is for platform teams and agent builders who need a review step before untrusted content reaches a model or a shell. The problem it solves is that a single "safe" boolean is not enough: a retrieved page can redirect the assistant, a message can carry personal data into the next tool, and a script can be dangerous without ever being executed. Gatekeeper keeps the evidence next to the decision, and the decision changes the payload.

## Endpoints used, and how the outputs work together

All three calls go out as one `POST /clocked/pipeline`. Each step is that endpoint's own request and response. `on_error` is `continue`, and no step sets `stop`, so one flagged or failed check cannot hide the others. The policy, not the pipeline, makes the call.

**Protect, `POST /pii`.** Every screen. The step asks for a mask (`anonymize: "mask"`, two trailing characters kept) over names, contact details, government and financial identifiers, and a described national-id kind so Arabic identity numbers have a place to land. The entity list, confidences, and `anonymized_text` change the payload: a pass with findings forwards the masked copy, and the spans are highlighted in the source. A finding whose value is still present in the masked copy, or a span with confidence under 0.60, holds the text for a person. A failed Protect call also holds it, because the raw text was not cleared.

**Guard, `POST /injection`.** Every screen. Messages are sent as `source: "user"`; email, retrieved pages, and scripts are `source: "content"`. The injection probability, verdict, category, category distribution, severity, and evidence quotes change the decision. Probability inside the band 0.35–0.65 around the 0.50 threshold asks a human, whatever the verdict. A high probability with an injection verdict and an attack category quarantines, and the evidence quotes are highlighted. A high score that disagrees with a benign category and comes back with no evidence span asks a human instead of quarantining on the scalar alone. A low score with a benign verdict clears this axis. A missing probability or a failed call blocks a pass.

**Inspect, `POST /script`.** Script intakes only. Prose does not get a script judgment, because that call would not mean anything. `malicious`, `suspicious`, the verdict, the category, and the evidence lines change the decision the same way Guard does, using the higher of the two risk probabilities. A malicious script quarantines even when Protect is clean and Guard is only uncertain, and the lines are highlighted. A benign script can pass. A failed Inspect call blocks a pass for a script.

The worst outcome wins: quarantine, then ask a human, then pass. A pass is the only state that releases text, and the released text is Protect's masked copy when any personal data was found.

## What we learned

Live calls against `clocked-1.0` on 10 November 2026 matched the documented contracts. Character offsets lined up as Unicode code points, including the Arabic name and the `+966` phone, with no realignment required. The seven samples cost well under 100 credits (about 2–11 credits a screen).

A few results changed the policy, not just the fixtures:

- A status email scored injection 0.003 and passed. An earlier draft that said "please book the room" inside an email (`source: "content"`) scored 0.77 with verdict `injection`, while the category was `benign` at 0.99, severity was `none`, and no evidence span came back. The same words as a user message scored 0.002. Content that gives the assistant an order is a different question from a person asking. Gatekeeper now treats a high injection score that disagrees with a benign category and an empty evidence list as ask-a-human.
- The classroom note that quotes an attack scored 0.44, verdict benign, inside the uncertain band, so it waits for a person. The vendor FAQ with a hidden instruction scored 0.997, category instruction override, with four evidence quotes, and is quarantined.
- On the sketchy install script, Guard sat in the band (0.38, verdict benign, category tool misuse) while Inspect returned malicious 0.996 and the `curl | bash`, credential, cron, and `chmod` lines. The quarantine comes from Inspect. That is why the pipeline does not stop early.
- Protect masked eight spans in the fictional English email and five in the Arabic note. The Arabic phone came back at confidence 0.66 and was released inside the mask. The national id was returned as `ssn`. Spans under 0.60, or a mask that still contains a finding, are not released.
- `Idempotency-Key` is required. A request without one is a 400. Retries reuse the same key. The bearer token is never logged, stored, or returned to the browser.

## Award categories

- Best Overall App
- Best Use of Protect, Guard, or Inspect
