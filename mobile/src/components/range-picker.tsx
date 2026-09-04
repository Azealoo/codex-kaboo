import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text } from "react-native";
import { presetLabel } from "@shared/range";
import { PRESETS, useRange } from "@/providers/range";
import { usePalette } from "@/providers/theme";
import { Muted } from "./ui";

/** The web's range pill as a header button that opens a preset sheet. */
export function RangePicker() {
  const p = usePalette();
  const { preset, setPreset, resolved } = useRange();
  const [open, setOpen] = useState(false);
  const label = resolved?.label ?? presetLabel(preset);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change date range"
        onPress={() => setOpen(true)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: p.border,
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: p.card,
        }}
      >
        <Ionicons name="calendar-outline" size={14} color={p.foreground} />
        <Text style={{ color: p.foreground, fontSize: 13, fontWeight: "500" }}>{label}</Text>
        <Ionicons name="chevron-down" size={14} color={p.mutedForeground} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: p.card,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              paddingBottom: 32,
              gap: 4,
            }}
          >
            <Muted style={{ marginBottom: 6 }}>Date range</Muted>
            {PRESETS.map((pr) => {
              const on = pr === preset;
              return (
                <Pressable
                  key={pr}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setPreset(pr);
                    setOpen(false);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    borderRadius: 10,
                    backgroundColor: on ? p.muted : "transparent",
                  }}
                >
                  <Text
                    style={{ color: p.foreground, fontSize: 15, fontWeight: on ? "600" : "400" }}
                  >
                    {presetLabel(pr)}
                  </Text>
                  {on ? <Ionicons name="checkmark" size={18} color={p.primary} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
