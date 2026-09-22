These publicly committed keys and certificates are synthetic fixtures used only by the isolated local Docker parity suite.
They must never be used by deployed services or trusted outside the parity containers.

The fixture proxy accepts CONNECT only for `chatgpt.com:443`, `auth.openai.com:443`, `api.currencyapi.com:443`,
and the local `oauth:8080` service,
terminates TLS locally, and returns simulated usage, reset-credit, and OAuth responses.
Both implementations retain their production URLs and certificate verification behavior.
