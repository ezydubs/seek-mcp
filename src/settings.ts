import { gql, sgql } from "./auth.js";
import { COUNTRY, LANGUAGE, LOCALE, ZONE, clean } from "./seek.js";

export async function notificationSettings() {
  const d = await sgql("GetCTPPreference", { locale: LOCALE, onlyProductionOption: true, zone: ZONE });
  return (d?.viewer?.notificationCTPPreferenceGroups ?? []).map((g: any) =>
    clean({
      category: g.category?.label,
      about: g.category?.description,
      notifications: (g.preferences ?? []).map((p: any) =>
        clean({
          id: p.product?.id,
          name: p.product?.label,
          about: p.product?.description,
          channels: (p.subscriptions ?? []).map((s: any) =>
            clean({
              channel: s.channel?.id,
              subscribed: s.subscribed,
              frequency: s.frequency?.value,
              frequencies: s.frequency?.options?.map((o: any) => o.id),
            }),
          ),
        }),
      ),
    }),
  );
}

export interface NotificationChange {
  id: string;
  channel: "email" | "push";
  subscribe: boolean;
  frequency?: "daily" | "weekly" | "dynamic";
}

export async function updateNotifications(changes: NotificationChange[]) {
  if (!changes.length) throw new Error("Give at least one notification to change");
  const byProduct = new Map<string, NotificationChange[]>();
  for (const c of changes) byProduct.set(c.id, [...(byProduct.get(c.id) ?? []), c]);
  await sgql("updateNotificationCtpPreferences", {
    input: {
      onlyProductionOption: true,
      zone: ZONE,
      preferences: [...byProduct].map(([id, list]) => ({
        id,
        notificationsChannel: list.map((c) => ({
          channel: c.channel,
          subscribe: c.subscribe,
          reason: "preferenceUI",
          ...(c.frequency ? { frequency: c.frequency } : {}),
        })),
      })),
    },
    locale: LOCALE,
  });
  return { updated: changes, now: await notificationSettings() };
}

const accountError = (r: any) => (r?.error ? `${r.error.message ?? r.error.code ?? "rejected"}` : null);

export async function changeEmailStart(newEmailAddress: string) {
  const r = (await sgql("changeEmailStart", { emailChangeStart: { newEmailAddress } }))?.changeEmailStart;
  const err = accountError(r);
  if (err) throw new Error(`Seek would not start the email change: ${err}`);
  return { codeSentTo: newEmailAddress, next: "Run seek_change_email again with the code from that email." };
}

export async function changeEmailVerify(newEmailAddress: string, verificationCode: string) {
  const r = (await sgql("changeEmailVerify", {
    emailChangeVerify: { newEmailAddress, verificationCode, brand: "seek", country: COUNTRY, language: LANGUAGE },
  }))?.changeEmailVerify;
  const err = accountError(r);
  if (err) throw new Error(`Seek did not accept the code: ${err}`);
  return { emailChanged: true, email: newEmailAddress };
}

export async function deleteAccount(confirmEmail: string) {
  const who = await gql(`query GetUserDetails { viewer { _id emailAddress } }`);
  const email = who?.viewer?.emailAddress;
  if (!email) throw new Error("Could not read the account email to confirm against");
  if (confirmEmail.trim().toLowerCase() !== String(email).toLowerCase()) {
    throw new Error("confirmEmail does not match the signed-in account's email; nothing was deleted");
  }
  const r = (await sgql("deleteAccount", { accountDelete: {} }))?.deleteAccount;
  const err = accountError(r);
  if (err) throw new Error(`Seek would not delete the account: ${err}`);
  return { deleted: true, email };
}
