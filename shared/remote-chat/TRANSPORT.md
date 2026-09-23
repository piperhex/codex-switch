# Remote chat transport compatibility

The coordinator continues to use WebSocket/TCP. No UDP or QUIC transport is introduced.

## Binary relay hop

A client advertises `binaryRelay: true` in authentication. The Go coordinator confirms it in
`chat-policy` before any session traffic. Each hop negotiates independently: one endpoint can
use binary while the other still uses JSON. A client connecting to an older coordinator sends
JSON unless that coordinator explicitly confirms support. Reconnection resets negotiation.

Binary messages contain `CSB1`, a one-byte session-ID length, the ASCII session ID (1–128 bytes),
then the unchanged authenticated ciphertext (at most 20,000 bytes). Routing, authorization,
rate limits and quotas still apply. Quotas count the encoded envelope actually written, as
with the previous JSON accounting; WebSocket/TLS headers are not included.

Hexadecimal remains the compatibility representation inside the typed native IPC and existing
encryption API. It is removed from the negotiated WebSocket hop. For a 10,000-byte ciphertext
and a nine-byte session ID, the new envelope is 10,014 bytes. Control messages remain JSON.

## Independent response delivery

Transport v2 peers advertise `parallelResponses: true` in authenticated ping/pong frames.
Until a peer advertises support, all application traffic uses the existing ordered delivery.
After negotiation, responses use a separate `responses` lane with its own bounded send window,
sequence space, cumulative acknowledgements, retry timers and fragment-ID namespace.
Response fragments can enter assembly out of order, so a missing history fragment does not
prevent another complete response from being delivered. Events and commands retain their
original ordering and have an independent window so a stalled response cannot fill it.

Duplicates are discarded within each lane. Both lanes survive direct/relay switches and relay
reconnection. This removes application-level coupling; it does not eliminate TCP head-of-line
blocking or the existing reliable ordered DataChannel's transport-level blocking.
