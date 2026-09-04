import { Image, Text, View } from "react-native";
import { usePalette } from "@/providers/theme";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function Avatar({
  name,
  imageUrl,
  color,
  size = 28,
}: {
  name: string;
  imageUrl: string | null;
  color?: string;
  size?: number;
}) {
  const p = usePalette();
  const ring = color ? { borderWidth: 2, borderColor: color } : { borderWidth: 0 };
  if (imageUrl)
    return (
      <Image
        source={{ uri: imageUrl }}
        accessibilityLabel={name}
        style={[{ width: size, height: size, borderRadius: size / 2 }, ring]}
      />
    );
  return (
    <View
      accessibilityLabel={name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: p.muted,
          alignItems: "center",
          justifyContent: "center",
        },
        ring,
      ]}
    >
      <Text style={{ color: p.mutedForeground, fontSize: size * 0.38, fontWeight: "600" }}>
        {initials(name) || "?"}
      </Text>
    </View>
  );
}
