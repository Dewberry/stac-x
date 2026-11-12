# Keycloak

stac-x signs people in against the FFRD realm, the same one FFRD Cloud uses:
`https://auth.dewberryanalytics.com/auth/realms/ffrd`. Nobody hosts a
Keycloak for this app; it needs a client in that realm and five environment
variables.

## The client

In the admin console (`/auth/admin/ffrd/console/`), Clients, then Create client:

| Setting | Value |
| --- | --- |
| Client type | OpenID Connect |
| Client ID | `stac-x` |
| Name | STAC |
| Client authentication | On (confidential) |
| Authentication flow | Standard flow only. Direct access grants, implicit flow and service accounts off |
| PKCE method (Advanced tab) | S256 |
| Root URL | `https://ffrd.cloud.dewberryanalytics.com/stac` |
| Home URL | `https://ffrd.cloud.dewberryanalytics.com/stac/` |
| Valid redirect URIs | `https://ffrd.cloud.dewberryanalytics.com/stac/*` and, for local work, `http://localhost:3000/*` |
| Valid post logout redirect URIs | the same two |
| Web origins | `+` |
| Front channel logout | Off |
| Backchannel logout URL | `https://ffrd.cloud.dewberryanalytics.com/stac/api/auth/backchannel-logout` |
| Backchannel logout session required | On |

Then copy the secret from the Credentials tab.

The local redirect URI is there so a laptop can sign in against the real
realm. Take it off if the realm's policy is to keep production clients
production-only, and use a second client for local work instead.

## Reviewers

To limit who can use Admin and save QC (which also promotes collections),
create a role and set `STAC_REVIEWER_ROLE` to its name. Either kind works:

- a client role on `stac-x` (Clients, stac-x, Roles), which keeps it out of
  the other FFRD apps, or
- a realm role, if one already means the right people.

Assign it to users or to a group. The role is read when someone signs in,
so a person given it has to sign out and back in. Leave `STAC_REVIEWER_ROLE`
unset and everyone who can sign in can review.

## The app's environment

```bash
KEYCLOAK_ISSUER=https://auth.dewberryanalytics.com/auth/realms/ffrd
KEYCLOAK_CLIENT_ID=stac-x
KEYCLOAK_CLIENT_SECRET=<from the Credentials tab>
AUTH_SECRET=<a long random string, different per deployment>
AUTH_URL=https://ffrd.cloud.dewberryanalytics.com
#STAC_REVIEWER_ROLE=stac-reviewer
```

`AUTH_URL` is the origin alone, with no `/stac`. The base path is baked into
the image (`NEXT_PUBLIC_BASE_PATH`), and Auth.js's routes sit under it at
`/stac/api/auth`. These are all read at run time, so turning sign-in on is a
change to the server's `.env` and a container restart, with no rebuild.

## What happens

- Opening any page without a session goes straight to Keycloak and back. Someone
  already signed in to another FFRD app doesn't see a sign-in page at all.
- API routes, the asset and preview proxies and server actions answer 401
  without a session. `/api/health` stays open for the Docker health check.
- Sessions last eight hours. Sign out ends the Keycloak session too, so it
  signs the person out of the other FFRD apps.
- When the Keycloak session ends anywhere else, Keycloak calls the
  back-channel URL and the session here ends on its next request.
- Each QC save records the username in the sidecar (`by`), and Admin's
  activity shows it. Records saved before sign-in have none.
