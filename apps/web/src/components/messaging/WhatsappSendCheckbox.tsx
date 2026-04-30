'use client';

import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

type Props = {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
};

export function WhatsappSendCheckbox({ checked, onCheckedChange, id = 'send-whatsapp', disabled }: Props) {
  return (
    <div className="flex items-start space-x-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
      />
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium leading-none cursor-pointer">
          Aussi par WhatsApp (WaSender)
        </Label>
        <p className="text-xs text-muted-foreground">
          Une trace est conservée dans l&apos;application (journal d&apos;envoi), même si WhatsApp est utilisé.
          Nécessite WASENDER_API_KEY et un numéro renseigné pour le destinataire.
        </p>
      </div>
    </div>
  );
}
