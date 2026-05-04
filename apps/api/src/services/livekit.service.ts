/**
 * LiveKit Service
 *
 * Thin wrapper over the livekit-server-sdk for room lifecycle, JWT minting,
 * Egress (recording) control, participant moderation and webhook receiver verification.
 *
 * Server credentials come from env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
 * S3 destination for recordings comes from the existing MinIO/S3 env vars plus an
 * optional LIVEKIT_RECORDINGS_S3_BUCKET override.
 */

import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  RoomCompositeOptions,
  RoomServiceClient,
  S3Upload,
  WebhookReceiver,
} from "livekit-server-sdk";

export type LiveKitJoinRole = "moderator" | "participant";

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKey: string;
    secret: string;
    forcePathStyle: boolean;
    keyPrefix: string;
  };
}

export interface MintTokenInput {
  roomName: string;
  identity: string;
  displayName?: string;
  role: LiveKitJoinRole;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

export class LiveKitService {
  private readonly cfg: LiveKitConfig;
  private readonly roomClient: RoomServiceClient;
  private readonly egressClient: EgressClient;
  private readonly webhookReceiver: WebhookReceiver;

  constructor(config?: Partial<LiveKitConfig>) {
    this.cfg = LiveKitService.loadConfig(config);
    this.roomClient = new RoomServiceClient(this.cfg.url, this.cfg.apiKey, this.cfg.apiSecret);
    this.egressClient = new EgressClient(this.cfg.url, this.cfg.apiKey, this.cfg.apiSecret);
    this.webhookReceiver = new WebhookReceiver(this.cfg.apiKey, this.cfg.apiSecret);
  }

  static loadConfig(overrides: Partial<LiveKitConfig> = {}): LiveKitConfig {
    const url = overrides.url ?? process.env.LIVEKIT_URL ?? "";
    const apiKey = overrides.apiKey ?? process.env.LIVEKIT_API_KEY ?? "";
    const apiSecret = overrides.apiSecret ?? process.env.LIVEKIT_API_SECRET ?? "";
    if (!url || !apiKey || !apiSecret) {
      throw new Error(
        "LiveKit not configured: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET"
      );
    }

    const s3Bucket =
      overrides.s3?.bucket ??
      process.env.LIVEKIT_RECORDINGS_S3_BUCKET ??
      process.env.MINIO_BUCKET ??
      "";
    const s3Region = overrides.s3?.region ?? process.env.AWS_REGION ?? "us-east-1";
    const s3Endpoint = overrides.s3?.endpoint ?? process.env.MINIO_ENDPOINT;
    const s3AccessKey =
      overrides.s3?.accessKey ?? process.env.AWS_ACCESS_KEY_ID ?? process.env.MINIO_USER ?? "";
    const s3Secret =
      overrides.s3?.secret ??
      process.env.AWS_SECRET_ACCESS_KEY ??
      process.env.MINIO_PASSWORD ??
      "";
    const forcePathStyle = overrides.s3?.forcePathStyle ?? Boolean(process.env.MINIO_ENDPOINT);
    const keyPrefix = overrides.s3?.keyPrefix ?? process.env.LIVEKIT_RECORDINGS_PREFIX ?? "live-sessions/";

    return {
      url,
      apiKey,
      apiSecret,
      s3: {
        bucket: s3Bucket,
        region: s3Region,
        endpoint: s3Endpoint && !s3Endpoint.startsWith("http") ? `http://${s3Endpoint}` : s3Endpoint,
        accessKey: s3AccessKey,
        secret: s3Secret,
        forcePathStyle,
        keyPrefix,
      },
    };
  }

  /** Build a LiveKit room name that cannot collide across tenants. */
  static buildRoomName(tenantId: string, liveSessionId: string): string {
    return `t_${tenantId.replace(/-/g, "")}__s_${liveSessionId.replace(/-/g, "")}`;
  }

  publicUrl(): string {
    return this.cfg.url;
  }

  async createRoom(roomName: string, opts?: { emptyTimeoutSec?: number; maxParticipants?: number }): Promise<void> {
    await this.roomClient.createRoom({
      name: roomName,
      emptyTimeout: opts?.emptyTimeoutSec ?? 600,
      maxParticipants: opts?.maxParticipants ?? 200,
    });
  }

  /** Mint a connection JWT. Moderators can publish + manage the room; participants can publish A/V only. */
  async mintToken(input: MintTokenInput): Promise<string> {
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, {
      identity: input.identity,
      name: input.displayName,
      ttl: `${input.ttlSeconds ?? 6 * 60 * 60}s`,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    at.addGrant({
      room: input.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: input.role === "moderator",
    });

    return at.toJwt();
  }

  async muteParticipant(roomName: string, identity: string): Promise<void> {
    const participant = await this.roomClient.getParticipant(roomName, identity);
    await Promise.all(
      (participant.tracks ?? [])
        .filter((t) => t.source === 1 /* MICROPHONE */ || t.type === 0 /* AUDIO */)
        .map((t) => this.roomClient.mutePublishedTrack(roomName, identity, t.sid, true))
    );
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    await this.roomClient.removeParticipant(roomName, identity);
  }

  async deleteRoom(roomName: string): Promise<void> {
    await this.roomClient.deleteRoom(roomName);
  }

  /**
   * Start a composite egress recording uploaded directly to the configured S3/MinIO bucket.
   * Returns the egress id so the caller can persist it on live_session_recordings.
   */
  async startCompositeRecording(
    roomName: string,
    s3KeyTemplate: string
  ): Promise<{ egressId: string; s3Key: string }> {
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3KeyTemplate,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: this.cfg.s3.accessKey,
          secret: this.cfg.s3.secret,
          region: this.cfg.s3.region,
          bucket: this.cfg.s3.bucket,
          endpoint: this.cfg.s3.endpoint,
          forcePathStyle: this.cfg.s3.forcePathStyle,
        }),
      },
    });

    const opts: RoomCompositeOptions = {
      layout: "grid",
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
    };

    const egress = await this.egressClient.startRoomCompositeEgress(roomName, { file: fileOutput }, opts);
    return { egressId: egress.egressId, s3Key: s3KeyTemplate };
  }

  async stopEgress(egressId: string): Promise<void> {
    try {
      await this.egressClient.stopEgress(egressId);
    } catch (err) {
      // Egress may already be terminating; surface as a warning to the caller via re-throw if it matters.
      throw err;
    }
  }

  /** Build the deterministic S3 key for a session's recording. */
  buildRecordingKey(tenantId: string, liveSessionId: string): string {
    const prefix = this.cfg.s3.keyPrefix.endsWith("/") ? this.cfg.s3.keyPrefix : `${this.cfg.s3.keyPrefix}/`;
    return `${prefix}${tenantId}/${liveSessionId}/{room_name}-{time}.mp4`;
  }

  /**
   * Verify a LiveKit webhook delivery and return the parsed event.
   * Throws if the signature does not match.
   */
  async verifyWebhook(rawBody: string, authHeader: string | undefined): Promise<any> {
    if (!authHeader) {
      throw new Error("Missing Authorization header on LiveKit webhook");
    }
    return this.webhookReceiver.receive(rawBody, authHeader);
  }
}

let _instance: LiveKitService | null = null;

/** Lazily-constructed shared instance so route handlers can grab the service without DI plumbing. */
export function getLiveKitService(): LiveKitService {
  if (!_instance) {
    _instance = new LiveKitService();
  }
  return _instance;
}

/** Test-only reset hook. */
export function _resetLiveKitServiceForTests(): void {
  _instance = null;
}
