import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useMetadataPref } from '#hooks/useMetadataPref';

export function DraftReceiptPicker({
  files,
  onChange,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [fileId] = useMetadataPref('cloudFileId');
  const [encryptKeyId] = useMetadataPref('encryptKeyId');
  const available = Boolean(fileId && !encryptKeyId);

  function choose(selected: File[]) {
    setError('');
    if (selected.some(file => file.size > 10 * 1024 * 1024)) {
      setError(
        t('Each receipt must be no larger than 10 MB.', {
          defaultValue: 'Ein Beleg darf h�chstens 10 MB gro� sein.',
        }),
      );
    } else if (files.length + selected.length > 20) {
      setError(
        t('Choose no more than 20 receipts.', {
          defaultValue: 'Du kannst h�chstens 20 Belege ausw�hlen.',
        }),
      );
    } else if (selected.some(file => !/\.(pdf|jpe?g|png)$/i.test(file.name))) {
      setError(
        t('Choose a PDF, JPEG or PNG file.', {
          defaultValue: 'W�hle eine PDF-, JPEG- oder PNG-Datei.',
        }),
      );
    } else {
      onChange([...files, ...selected]);
    }
    if (input.current) input.current.value = '';
  }

  return (
    <View style={{ padding: '16px 8px', gap: 8 }}>
      <input
        ref={input}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={event => choose(Array.from(event.target.files || []))}
      />
      <Button
        style={{ minHeight: 44, width: '100%' }}
        isDisabled={disabled || !available}
        onPress={() => input.current?.click()}
      >
        <Trans defaults="Beleg ausw�hlen">Choose receipt</Trans>
      </Button>
      <div style={{ color: theme.pageText }}>
        {available
          ? t('Selected receipts will upload after you save the transaction.', {
              defaultValue:
                'PDF, JPEG oder PNG � bis zu 10 MB pro Datei. Die Belege werden beim Speichern der Buchung hochgeladen.',
            })
          : t('Receipts need a server budget without end-to-end encryption.', {
              defaultValue:
                'Belege ben�tigen ein Serverbudget ohne Ende-zu-Ende-Verschl�sselung.',
            })}
      </div>
      {files.map((file, index) => (
        <View
          key={index}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {file.name}
          </div>
          <Button
            style={{ minHeight: 44 }}
            isDisabled={disabled}
            aria-label={t('Remove selected receipt {{name}}', {
              name: file.name,
              defaultValue: 'Ausgew�hlten Beleg {{name}} entfernen',
            })}
            onPress={() => onChange(files.filter((_, item) => item !== index))}
          >
            <Trans defaults="Entfernen">Remove</Trans>
          </Button>
        </View>
      ))}
      {error && (
        <div role="alert" style={{ color: theme.errorText }}>
          {error}
        </div>
      )}
    </View>
  );
}

