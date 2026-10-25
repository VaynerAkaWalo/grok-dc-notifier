export interface User {
  id: string;
  username?: string;
  bot?: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: User;
  content?: string;
  timestamp?: string;
  mentions?: User[];
  mention_roles?: string[];
  webhook_id?: string;
  referenced_message?: Message | null;
}

// Announcement, public and private threads.
export const threadTypes = new Set([10, 11, 12]);

export interface Channel {
  id: string;
  type?: number;
  guild_id?: string;
  parent_id?: string | null;
  owner_id?: string;
}

export const isThread = (channel: Channel | undefined) =>
  channel?.type !== undefined && threadTypes.has(channel.type);

export interface Role {
  id: string;
  tags?: { bot_id?: string };
}

// The subset of GUILD_CREATE the notifier reads.
export interface Guild {
  id: string;
  roles?: Role[];
  channels?: Channel[];
  threads?: Channel[];
}
