export class AccessPolicy {
  constructor(
    private readonly allowedUserIds: Set<string>,
    private readonly allowedGuildIds: Set<string>,
  ) {}

  allowsGuild(guildId: string | undefined): boolean {
    const isDirectMessage = !guildId;
    const anyGuildAllowed = this.allowedGuildIds.size === 0;

    return (
      isDirectMessage || anyGuildAllowed || this.allowedGuildIds.has(guildId)
    );
  }

  allowsAuthor(userId: string): boolean {
    return this.allowedUserIds.has(userId);
  }
}
