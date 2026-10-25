import type { Message, Role } from "../discord/schemas.ts";

export class BotIdentity {
  id = "";
  private readonly managedRoleIds = new Set<string>();

  get known(): boolean {
    return this.id !== "";
  }

  get managedRoleCount(): number {
    return this.managedRoleIds.size;
  }

  rememberRole(role: Role) {
    if (this.known && role.tags?.bot_id === this.id) {
      this.managedRoleIds.add(role.id);
    }
  }

  forgetRole(roleId: string) {
    this.managedRoleIds.delete(roleId);
  }

  authored(message: Message): boolean {
    return this.known && message.author.id === this.id;
  }

  mentionedIn(message: Message): boolean {
    if (!this.known) {
      return false;
    }

    const mentionsUser = (message.mentions ?? []).some(
      (user) => user.id === this.id,
    );
    const mentionsRole = (message.mention_roles ?? []).some((roleId) =>
      this.managedRoleIds.has(roleId),
    );

    return mentionsUser || mentionsRole;
  }

  involvedIn(message: Message): boolean {
    return this.authored(message) || this.mentionedIn(message);
  }
}
