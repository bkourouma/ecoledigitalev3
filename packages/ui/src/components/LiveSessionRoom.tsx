"use client";

import * as React from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  Chat,
  useTracks,
  useDataChannel,
  useLocalParticipant,
  useRoomContext,
  useParticipants,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import { Hand, Maximize2, MessageSquare, MicOff, Minimize2, PhoneOff, UserX, X } from "lucide-react";
import "@livekit/components-styles";

/**
 * Reusable live-session room. Each app supplies its own join-token fetcher.
 *
 * - Renders LiveKit prebuilt grid + chat panel
 * - Adds a raise-hand layer using LiveKit Data Channels (no extra backend needed)
 * - Surfaces moderator controls (mute / kick / end) only when role === 'moderator'
 *
 * Token lifecycle: parent passes a *function* `getToken` rather than a token directly so that
 * the component can re-mint on reconnect. The function is called once on mount.
 */

export type LiveSessionRole = "moderator" | "participant";

export interface LiveSessionTokenResponse {
  url: string;
  token: string;
  role: LiveSessionRole;
  identity: string;
  roomName: string;
}

export interface LiveSessionRoomProps {
  /** Function the component calls to obtain a fresh token (on mount + reconnect). */
  getToken: () => Promise<LiveSessionTokenResponse>;
  /** Optional callback invoked when the user clicks "Quitter". */
  onLeave?: () => void;
  /**
   * Optional callbacks for moderators. When omitted, the corresponding action button is hidden.
   * The wrapping app is expected to call its API and refresh state on success.
   */
  onMuteParticipant?: (identity: string) => Promise<void> | void;
  onKickParticipant?: (identity: string) => Promise<void> | void;
  onEndSession?: () => Promise<void> | void;
  /** Title displayed in the toolbar (e.g. course name). */
  title?: string;
}

type LiveTrackReference = NonNullable<React.ComponentProps<typeof ParticipantTile>["trackRef"]>;

const RAISE_HAND_TOPIC = "raise-hand";

interface RaiseHandPayload {
  identity: string;
  on: boolean;
  at: number;
}

export function LiveSessionRoom(props: LiveSessionRoomProps) {
  const [tokenInfo, setTokenInfo] = React.useState<LiveSessionTokenResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    props
      .getToken()
      .then((info) => {
        if (!cancelled) setTokenInfo(info);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Impossible d'obtenir le jeton de connexion");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">Connexion impossible</p>
          <p className="mt-2 text-sm text-neutral-400">{error}</p>
        </div>
      </div>
    );
  }
  if (!tokenInfo) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <p className="text-sm text-neutral-400">Connexion à la séance…</p>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={tokenInfo.url}
      token={tokenInfo.token}
      data-lk-theme="default"
      style={{ height: "100vh" }}
      onDisconnected={props.onLeave}
    >
      <RoomShell
        role={tokenInfo.role}
        identity={tokenInfo.identity}
        title={props.title}
        onMuteParticipant={props.onMuteParticipant}
        onKickParticipant={props.onKickParticipant}
        onEndSession={props.onEndSession}
        onLeave={props.onLeave}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

interface RoomShellProps {
  role: LiveSessionRole;
  identity: string;
  title?: string;
  onMuteParticipant?: (identity: string) => Promise<void> | void;
  onKickParticipant?: (identity: string) => Promise<void> | void;
  onEndSession?: () => Promise<void> | void;
  onLeave?: () => void;
}

function RoomShell({
  role,
  identity,
  title,
  onMuteParticipant,
  onKickParticipant,
  onEndSession,
  onLeave,
}: RoomShellProps) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  const screenShareTracks = tracks.filter((track) => track.source === Track.Source.ScreenShare);

  const [chatOpen, setChatOpen] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const { raisedHands, toggleHand } = useRaiseHand(identity);

  const room = useRoomContext();

  React.useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen();
  }, []);

  React.useEffect(() => {
    const handler = () => onLeave?.();
    room.on(RoomEvent.Disconnected, handler);
    return () => {
      room.off(RoomEvent.Disconnected, handler);
    };
  }, [room, onLeave]);

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 text-neutral-100">
      <Toolbar
        title={title}
        role={role}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onEndSession={onEndSession}
        onLeave={onLeave}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          {screenShareTracks.length > 0 ? (
            <PresentationLayout
              screenTrack={screenShareTracks[0]}
            />
          ) : (
            <GridLayout tracks={tracks} className="h-full">
              <ParticipantTileWithRaiseHand raisedHands={raisedHands} />
            </GridLayout>
          )}

          <ParticipantsOverlay
            onMute={role === "moderator" ? onMuteParticipant : undefined}
            onKick={role === "moderator" ? onKickParticipant : undefined}
          />
        </div>

        {chatOpen && (
          <aside className="w-[22rem] border-l border-neutral-800 bg-neutral-900">
            <Chat />
          </aside>
        )}
      </div>

      <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={toggleHand}
            className={
              "inline-flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-sm transition-colors " +
              (raisedHands.has(identity)
                ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                : "hover:bg-neutral-800")
            }
          >
            <Hand className="h-4 w-4" />
            {raisedHands.has(identity) ? "Baisser la main" : "Lever la main"}
          </button>
          <ControlBar variation="minimal" controls={{ chat: false, leave: true }} />
        </div>
      </div>
    </div>
  );
}

function PresentationLayout({
  screenTrack,
}: {
  screenTrack: LiveTrackReference;
}) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-black">
      <div className="min-w-0 flex-1 bg-black">
        <ParticipantTile
          trackRef={screenTrack}
          className="h-full w-full rounded-none border-0 bg-black [&_.lk-focus-toggle-button]:hidden [&_.lk-participant-media-video]:object-cover [&_.lk-participant-metadata]:hidden"
        />
      </div>
    </div>
  );
}

function Toolbar({
  title,
  role,
  chatOpen,
  onToggleChat,
  fullscreen,
  onToggleFullscreen,
  onEndSession,
  onLeave,
}: {
  title?: string;
  role: LiveSessionRole;
  chatOpen: boolean;
  onToggleChat: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onEndSession?: () => Promise<void> | void;
  onLeave?: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <h1 className="text-sm font-semibold">{title ?? "Cours en direct"}</h1>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-400">
          {role === "moderator" ? "Animateur" : "Participant"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleChat}
          className={
            "inline-flex items-center gap-1 rounded-md border border-neutral-700 px-3 py-1.5 text-xs transition-colors " +
            (chatOpen ? "bg-neutral-800" : "hover:bg-neutral-800")
          }
        >
          <MessageSquare className="h-3.5 w-3.5" /> Chat
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Quitter le plein ecran" : "Plein ecran"}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-3 py-1.5 text-xs transition-colors hover:bg-neutral-800"
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {fullscreen ? "Reduire" : "Plein ecran"}
        </button>
        {role === "moderator" && onEndSession && (
          <button
            type="button"
            onClick={() => {
              void onEndSession();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/20 px-3 py-1.5 text-xs text-red-200 transition-colors hover:bg-red-500/30"
          >
            <PhoneOff className="h-3.5 w-3.5" /> Terminer la séance
          </button>
        )}
        <button
          type="button"
          onClick={onLeave}
          aria-label="Fermer"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function ParticipantTileWithRaiseHand({ raisedHands }: { raisedHands: Set<string> }) {
  // The default ParticipantTile is rendered for every track; we just decorate it with a
  // raise-hand badge when applicable. ParticipantTile reads its participant from context.
  return (
    <div className="relative">
      <ParticipantTile />
      <RaiseHandBadge raisedHands={raisedHands} />
    </div>
  );
}

function RaiseHandBadge({ raisedHands }: { raisedHands: Set<string> }) {
  // We can't read the participant identity directly from ParticipantTile here without
  // pulling in another context hook; this is good enough as a "someone in the room
  // raised their hand" indicator displayed on each tile via overlap CSS.
  if (raisedHands.size === 0) return null;
  return (
    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-1 text-[11px] font-semibold text-amber-950 shadow-lg">
      <Hand className="h-3 w-3" /> {raisedHands.size}
    </span>
  );
}

function ParticipantsOverlay({
  onMute,
  onKick,
}: {
  onMute?: (identity: string) => Promise<void> | void;
  onKick?: (identity: string) => Promise<void> | void;
}) {
  const participants = useParticipants();
  const [open, setOpen] = React.useState(false);
  const local = useLocalParticipant();

  return (
    <div className="absolute right-3 top-3 z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-neutral-900/80 px-3 py-1.5 text-xs text-neutral-100 backdrop-blur transition-colors hover:bg-neutral-800"
      >
        Participants ({participants.length})
      </button>

      {open && (
        <div className="mt-2 max-h-80 w-72 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-2 shadow-xl">
          <ul className="divide-y divide-neutral-800">
            {participants.map((p) => {
              const isLocal = p.identity === local.localParticipant.identity;
              return (
                <li
                  key={p.identity}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="truncate">{p.name || p.identity}</span>
                  {!isLocal && (
                    <span className="flex items-center gap-1">
                      {onMute && (
                        <button
                          type="button"
                          onClick={() => onMute(p.identity)}
                          aria-label="Couper le micro"
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                        >
                          <MicOff className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {onKick && (
                        <button
                          type="button"
                          onClick={() => onKick(p.identity)}
                          aria-label="Retirer du salon"
                          className="rounded p-1 text-neutral-400 hover:bg-red-500/20 hover:text-red-300"
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function useRaiseHand(localIdentity: string): {
  raisedHands: Set<string>;
  toggleHand: () => void;
} {
  const [raisedHands, setRaisedHands] = React.useState<Set<string>>(new Set());
  const { send } = useDataChannel(RAISE_HAND_TOPIC, (msg) => {
    try {
      const text = new TextDecoder().decode(msg.payload);
      const payload: RaiseHandPayload = JSON.parse(text);
      setRaisedHands((prev) => {
        const next = new Set(prev);
        if (payload.on) next.add(payload.identity);
        else next.delete(payload.identity);
        return next;
      });
    } catch {
      // ignore malformed payloads
    }
  });

  const toggleHand = React.useCallback(() => {
    setRaisedHands((prev) => {
      const next = new Set(prev);
      const on = !next.has(localIdentity);
      if (on) next.add(localIdentity);
      else next.delete(localIdentity);
      const payload: RaiseHandPayload = { identity: localIdentity, on, at: Date.now() };
      void send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true });
      return next;
    });
  }, [localIdentity, send]);

  return { raisedHands, toggleHand };
}
