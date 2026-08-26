# Blake in Your Pocket Technical Assessment

Status: architecture agreed for GitHub issue #207; mobile build starts after the shared Core contract is stable.

## Recommendation

Build `apps/blake-mobile` with the current stable Expo SDK and React Native. It will be a dedicated voice-first NeXa client, not a second AI product.

The app owns:

- NeXa sign-in and secure local session storage.
- Voice/text/photo capture and playback.
- Conversation presentation, result cards and confirmation UI.
- Mobile lifecycle, connectivity, retry and clear offline states.
- Deep links into authorised NeXa records.

NeXa/Blake Core owns:

- Conversation and workflow state.
- OpenAI model/tool orchestration.
- Search, schedules, reporting, leads, jobs, quotes, invoices and all future capabilities.
- Tenant and permission enforcement.
- Confirmation tokens, persistence and audit.
- Ephemeral OpenAI Realtime client-secret minting.

## Framework assessment

- Expo is suitable for the initial iOS and Android companion because this repository has no existing mobile app to preserve and the first release is a standard authenticated voice/text client.
- Use the stable SDK, not a prerelease. Expo SDK packages are version-aligned with React Native and should be installed with `expo install`.
- Store only the NeXa session/refresh material in `expo-secure-store`; do not store large conversation payloads or any permanent OpenAI key there.
- Use `expo-audio` for supported recording/playback needs. Do not start new work on deprecated `expo-av` audio APIs.
- A development build will be required before production-quality native voice/background behavior is signed off. Expo Go is useful only for early shell work.

## API shape

The mobile app consumes the same authenticated capability API as web and voice:

1. Sign in to NeXa.
2. Create/resume a server conversation context with channel `mobile_text` or `mobile_voice`.
3. Send text or establish a Realtime session using a server-minted ephemeral credential.
4. Blake chooses only capabilities allowed for the authenticated user.
5. NeXa returns bounded results or a confirmation card.
6. The app submits confirmation; Blake Core executes and audits the write.

## Delivery phases

1. Core contract and web proofs.
2. Expo shell, authentication, secure session and environment configuration.
3. Text conversation against Blake Core.
4. Voice connection using the shared conversation and capability executor.
5. Result cards, confirmations, history and activity.
6. Reliability, telemetry, TestFlight/internal testing and store-readiness review.

V1 makes no CarPlay claim. Offline mode will queue user-created drafts/media only where the server API explicitly supports idempotent replay; it will not answer availability or claim writes succeeded while disconnected.
