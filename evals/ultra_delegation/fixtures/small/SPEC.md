# Requirements
## Authentication
Only active accounts may authenticate. Expired tokens are invalid. Admin endpoints must require role=admin on the current user, never a flag supplied by the requester.
## Billing
Prices and amounts use integer cents. Confirmed payment events can be retried; a given event ID must be applied exactly once even if two deliveries overlap. Refunds must never exceed the paid amount. Discounts are bounded to 0..100 percent.
## Export
A tenant may export only its own records. Export jobs belong to the requesting tenant. Download must verify this ownership, including cache hits. Records marked deleted must be excluded.
