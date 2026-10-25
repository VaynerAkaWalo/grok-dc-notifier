import type { Channel, Guild, Role } from "../discord/schemas.ts";
import type { Logger } from "../infra/logger.ts";
import type { BotIdentity } from "../state/bot-identity.ts";
import type { ChannelDirectory } from "./channel-directory.ts";

export class GuildEvents {
  constructor(
    private readonly identity: BotIdentity,
    private readonly channels: ChannelDirectory,
    private readonly log: Logger,
  ) {}

  guildCreated(guild: Guild) {
    for (const role of guild.roles ?? []) {
      this.identity.rememberRole(role);
    }

    for (const channel of [
      ...(guild.channels ?? []),
      ...(guild.threads ?? []),
    ]) {
      this.channels.remember({ ...channel, guild_id: guild.id });
    }

    this.log.info(
      {
        guildId: guild.id,
        channels: guild.channels?.length ?? 0,
        activeThreads: guild.threads?.length ?? 0,
        botRoles: this.identity.managedRoleCount,
      },
      "guild loaded",
    );
  }

  roleChanged(role: Role) {
    this.identity.rememberRole(role);
  }

  roleDeleted(roleId: string) {
    this.identity.forgetRole(roleId);
  }

  channelChanged(channel: Channel) {
    this.channels.remember(channel);
  }

  channelDeleted(channel: Channel) {
    this.channels.forget(channel.id);
  }

  threadsSynced(threads: Channel[]) {
    for (const thread of threads) {
      this.channels.remember(thread);
    }
  }
}
