export interface ModifierIcon {
	icon: string;
	color: string;
	label: string;
}

const MODIFIER_ICONS: Record<string, ModifierIcon> = {
	HashModifier: {
		icon: "i-ph-fingerprint",
		color: "text-rose-500",
		label: "Hashed",
	},
	LocalizationModifier: {
		icon: "i-ph-translate",
		color: "text-cyan-500",
		label: "Localized",
	},
	EncryptionModifier: {
		icon: "i-ph-lock-key",
		color: "text-indigo-500",
		label: "Encrypted",
	},
};

const fallbackModifierIcon = (id: string): ModifierIcon => ({
	icon: "i-ph-question",
	color: "text-muted",
	label: id,
});

export function resolveModifierIcon(modifierId: string): ModifierIcon {
	return MODIFIER_ICONS[modifierId] ?? fallbackModifierIcon(modifierId);
}
