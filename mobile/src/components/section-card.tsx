import type { ReactNode } from "react";
import { View } from "react-native";
import { Card, Muted, Title } from "./ui";

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Title>{title}</Title>
            {description ? <Muted>{description}</Muted> : null}
          </View>
        </View>
        {actions ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{actions}</View>
        ) : null}
      </View>
      {children}
    </Card>
  );
}
