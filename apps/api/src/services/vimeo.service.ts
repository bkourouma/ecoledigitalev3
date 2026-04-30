import axios from "axios";

interface VimeoUploadResult {
  videoId: string;
  playerUrl: string;
  thumbnailUrl: string;
}

export class VimeoService {
  private readonly baseUrl: string;
  private readonly accessToken: string;

  constructor() {
    this.baseUrl = process.env.VIMEO_BASE_URL || "https://api.vimeo.com";
    this.accessToken = process.env.VIMEO_ACCESS_TOKEN || "";
  }

  isConfigured(): boolean {
    return !!this.accessToken;
  }

  extractVideoIdFromUrl(url: string): string | null {
    const direct = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (direct?.[1]) return direct[1];

    const player = url.match(/player\.vimeo\.com\/video\/(\d+)/i);
    if (player?.[1]) return player[1];

    return null;
  }

  async uploadVideo(
    fileBuffer: Buffer,
    options: { title: string; description?: string; mimeType: string }
  ): Promise<VimeoUploadResult> {
    if (!this.isConfigured()) {
      throw new Error("VIMEO_NOT_CONFIGURED");
    }

    const createRes = await axios.post(
      `${this.baseUrl}/me/videos`,
      {
        upload: {
          approach: "post",
          size: fileBuffer.length,
        },
        name: options.title,
        description: options.description || "",
      },
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.vimeo.*+json;version=3.4",
        },
        timeout: 30000,
      }
    );

    const uploadLink: string | undefined = createRes.data?.upload?.upload_link;
    const uri: string | undefined = createRes.data?.uri;
    if (!uploadLink || !uri) {
      throw new Error("VIMEO_UPLOAD_LINK_MISSING");
    }

    await axios.put(uploadLink, fileBuffer, {
      headers: {
        "Content-Type": options.mimeType || "video/mp4",
      },
      maxBodyLength: Infinity,
      timeout: 180000,
    });

    const videoId = uri.split("/").pop();
    if (!videoId) {
      throw new Error("VIMEO_VIDEO_ID_MISSING");
    }

    return {
      videoId,
      playerUrl: `https://player.vimeo.com/video/${videoId}`,
      thumbnailUrl: `https://vumbnail.com/${videoId}.jpg`,
    };
  }
}

