import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { Receipt } from '@actual-app/core/types/receipts';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { notifyReceiptStatusChanged } from '#components/transactions/ReceiptStatus';
import { useMetadataPref } from '#hooks/useMetadataPref';

export function TransactionReceiptsModal({
  transactionId,
  initialFiles = [],
  onClose,
}: {
  transactionId: string;
  initialFiles?: File[];
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const [cloudFileId] = useMetadataPref('cloudFileId');
  const [encryptKeyId] = useMetadataPref('encryptKeyId');
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(true);
  const [pendingFiles, setPendingFiles] = useState(initialFiles);
  const startedInitialUpload = useRef(false);
  const uploadingPending = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    receipt: Receipt;
    url: string;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ready = Boolean(cloudFileId && !encryptKeyId);

  function errorMessage(reason: string) {
    switch (reason) {
      case 'receipt-server-missing':
        return t(
          'The receipt server is missing. Update and restart the test container.',
          {
            defaultValue:
              'Der Serverteil der Belegfunktion fehlt. Aktualisiere die Testinstallation und starte ihren Container neu.',
          },
        );
      case 'receipt-network-failure':
      case 'network':
        return t(
          'The receipt server cannot be reached. Check the SSH tunnel and try again.',
          {
            defaultValue:
              'Der Belegserver ist nicht erreichbar. Pr�fe den SSH-Tunnel und versuche es erneut.',
          },
        );
      case 'receipt-storage-failure':
        return t(
          'The server could not save the receipt. Check its storage permissions and free space.',
          {
            defaultValue:
              'Der Server konnte den Beleg nicht speichern. Pr�fe die Schreibrechte und den freien Speicher der Testinstallation.',
          },
        );
      case 'receipt-too-large':
        return t('Each receipt must be no larger than 10 MB.', {
          defaultValue: 'Ein Beleg darf h�chstens 10 MB gro� sein.',
        });
      case 'receipt-invalid-type':
        return t('Choose a PDF, JPEG or PNG file.', {
          defaultValue: 'W�hle eine PDF-, JPEG- oder PNG-Datei.',
        });
      case 'receipt-invalid-name':
        return t('Rename the file using a short filename without slashes.', {
          defaultValue: 'Gib der Datei einen kurzen Namen ohne Schr�gstriche.',
        });
      case 'receipt-count-limit':
        return t('There are already 20 receipts for this transaction.', {
          defaultValue: 'An dieser Buchung h�ngen bereits 20 Belege.',
        });
      case 'receipt-storage-limit':
        return t(
          'The receipt storage is full. Check your backups before removing old receipts.',
          {
            defaultValue:
              'Der Belegspeicher ist voll. Pr�ft eure Sicherungen, bevor ihr alte Belege entfernt.',
          },
        );
      case 'receipt-save-transaction':
        return t('Save the transaction before adding receipts.', {
          defaultValue:
            'Speichere zuerst die Buchung. Danach kannst du Belege hinzuf�gen.',
        });
      case 'unauthorized':
      case 'token-expired':
        return t('Sign in again to access receipts.', {
          defaultValue: 'Melde dich erneut an, um auf die Belege zuzugreifen.',
        });
      case 'file-access-not-allowed':
        return t('You do not have access to this budget.', {
          defaultValue: 'Du hast keinen Zugriff auf dieses Budget.',
        });
      case 'receipt-encrypted-budget':
        return t(
          'Receipts are not available for encrypted budgets in this test version.',
          {
            defaultValue:
              'Bei verschl�sselten Budgets sind Belege in dieser Testversion noch nicht verf�gbar.',
          },
        );
      default:
        return t(
          'Receipts could not be loaded or saved. Check the server connection and try again.',
          {
            defaultValue:
              'Belege konnten nicht geladen oder gespeichert werden. Pr�fe die Serververbindung und versuche es erneut.',
          },
        );
    }
  }

  useEffect(() => {
    let active = true;
    if (!ready) {
      setBusy(false);
      return;
    }
    void send('receipts-list', { transactionId, fileId: cloudFileId || '' })
      .then(result => {
        if (!active) return;
        if (result.error) {
          setError(errorMessage(result.error));
        } else {
          setReceipts(result.data || []);
        }
      })
      .catch(() => {
        if (active) setError(errorMessage('network'));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
    // The error copy is derived from the current language, not a request dependency.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, ready, cloudFileId]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function upload(file: File) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) {
        setError(errorMessage('receipt-too-large'));
        return false;
      }
      const result = await send('receipts-upload', {
        transactionId,
        fileId: cloudFileId || '',
        name: file.name,
        bytes: await file.arrayBuffer(),
      });
      if (result.error) {
        setError(errorMessage(result.error));
        return false;
      } else if (result.data) {
        setReceipts(items => [...items, result.data]);
        notifyReceiptStatusChanged();
        setMessage(t('Receipt saved.', { defaultValue: 'Beleg gespeichert.' }));
        return true;
      }
    } catch {
      setError(errorMessage('network'));
      return false;
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function uploadPending() {
    if (uploadingPending.current) return;
    uploadingPending.current = true;
    try {
      for (const file of pendingFiles) {
        const success = await upload(file);
        if (!success) break;
        setPendingFiles(files => files.filter(item => item !== file));
      }
    } finally {
      uploadingPending.current = false;
    }
  }

  useEffect(() => {
    if (
      !busy &&
      ready &&
      pendingFiles.length > 0 &&
      !startedInitialUpload.current
    ) {
      startedInitialUpload.current = true;
      void uploadPending();
    }
    // Start the selected files once, after the existing receipt list is loaded.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, ready]);

  async function load(receipt: Receipt, download: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await send('receipts-download', {
        transactionId,
        fileId: cloudFileId || '',
        receiptId: receipt.id,
      });
      if (result.error || !result.data) {
        setError(errorMessage(result.error || 'network'));
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.data], { type: receipt.mime }),
      );
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = receipt.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        setPreview({ receipt, url });
      }
    } catch {
      setError(errorMessage('network'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await send('receipts-delete', {
        transactionId,
        fileId: cloudFileId || '',
        receiptId: id,
      });
      if (result.error) {
        setError(errorMessage(result.error));
      } else {
        setReceipts(items => items.filter(item => item.id !== id));
        notifyReceiptStatusChanged();
        setDeleting(null);
        if (preview?.receipt.id === id) setPreview(null);
        setMessage(t('Receipt deleted.', { defaultValue: 'Beleg gel�scht.' }));
      }
    } catch {
      setError(errorMessage('network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      name="transaction-receipts"
      onClose={onClose}
      containerProps={{
        style: { width: 'min(640px, 90vw)', maxWidth: '90vw' },
      }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Transaction receipts', {
              defaultValue: 'Belege zur Buchung',
            })}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 16 }}>
            {pendingFiles.length > 0 && (
              <View style={{ gap: 8 }}>
                <div>
                  {t('Selected receipts are not uploaded yet.', {
                    defaultValue:
                      'Die Buchung ist gespeichert. Diese Belege sind noch nicht hochgeladen:',
                  })}
                </div>
                {pendingFiles.map((file, index) => (
                  <div key={index} style={{ overflowWrap: 'anywhere' }}>
                    {file.name}
                  </div>
                ))}
                <Button
                  style={{ minHeight: 44 }}
                  isDisabled={busy || !ready}
                  onPress={() => void uploadPending()}
                >
                  {t('Retry receipt upload', {
                    defaultValue: 'Belege erneut hochladen',
                  })}
                </Button>
                <div>
                  {t(
                    'Keep this dialog open until the receipts have uploaded.',
                    {
                      defaultValue:
                        'Lass diesen Dialog ge�ffnet, bis die Belege hochgeladen sind. Beim Schlie�en werden nicht hochgeladene Belege verworfen.',
                    },
                  )}
                </div>
              </View>
            )}
            <div>
              {t(
                'For split transactions, receipts belong to the whole transaction.',
                {
                  defaultValue:
                    'Bei aufgeteilten Ausgaben geh�rt der Beleg zur gesamten Buchung.',
                },
              )}
            </div>
            {!ready ? (
              <output>
                {encryptKeyId
                  ? errorMessage('receipt-encrypted-budget')
                  : t(
                      'Connect and sync this budget with the server to add receipts.',
                      {
                        defaultValue:
                          'Verbinde dieses Budget mit dem Server und synchronisiere es, um Belege hinzuzuf�gen.',
                      },
                    )}
              </output>
            ) : (
              <>
                <input
                  ref={input}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  style={{ display: 'none' }}
                  aria-label={t('Choose receipt', {
                    defaultValue: 'Beleg ausw�hlen',
                  })}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <View
                  role="region"
                  aria-label={t('Receipt upload area', {
                    defaultValue: 'Beleg hochladen',
                  })}
                  style={{
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: 16,
                    border: `2px dashed ${dragging ? theme.buttonPrimaryBackground : theme.tableBorder}`,
                    borderRadius: 6,
                  }}
                  onDragOver={event => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={event => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      setDragging(false);
                    }
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    setDragging(false);
                    if (busy) return;
                    const files = event.dataTransfer.files;
                    if (files.length > 1) {
                      setError(
                        t('Drop one receipt at a time.', {
                          defaultValue:
                            'Ziehe bitte einen Beleg nach dem anderen hier hinein.',
                        }),
                      );
                    } else if (files[0]) {
                      void upload(files[0]);
                    }
                  }}
                >
                  <div>
                    {t('Drop your receipt here or choose a file.', {
                      defaultValue:
                        'Ziehe deinen Beleg hier hinein oder w�hle eine Datei aus.',
                    })}
                  </div>
                  <Button
                    style={{ minHeight: isNarrowWidth ? 44 : undefined }}
                    variant="primary"
                    isDisabled={busy}
                    onPress={() => input.current?.click()}
                  >
                    {t('Add receipt', { defaultValue: 'Beleg hinzuf�gen' })}
                  </Button>
                  <div style={{ color: theme.pageText }}>
                    {t('PDF, JPEG or PNG � up to 10 MB per file', {
                      defaultValue:
                        'PDF, JPEG oder PNG � bis zu 10 MB pro Datei',
                    })}
                  </div>
                </View>
                {busy && (
                  <output>
                    {t('Loading or saving receipts.', {
                      defaultValue: 'Belege werden geladen oder gespeichert.',
                    })}
                  </output>
                )}
                {error && (
                  <div role="alert" style={{ color: theme.errorText }}>
                    {error}
                  </div>
                )}
                {message && <output>{message}</output>}
                {!busy && !error && receipts.length === 0 && (
                  <div>
                    {t(
                      'No receipts yet. Add the invoice or a photo of the receipt here.',
                      {
                        defaultValue:
                          'Hier ist noch kein Beleg hinterlegt. Du kannst die Rechnung oder ein Foto des Kassenbons hinzuf�gen.',
                      },
                    )}
                  </div>
                )}
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {receipts.map(receipt => (
                    <li
                      key={receipt.id}
                      style={{
                        padding: '12px 0',
                        borderTop: `1px solid ${theme.tableBorder}`,
                      }}
                    >
                      <div
                        style={{ overflowWrap: 'anywhere', fontWeight: 600 }}
                      >
                        {receipt.name}
                      </div>
                      <div style={{ marginTop: 4, color: theme.pageText }}>
                        {Math.ceil(receipt.size / 1024)} KB
                      </div>
                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 8,
                        }}
                      >
                        <Button
                          style={{ minHeight: isNarrowWidth ? 44 : undefined }}
                          isDisabled={busy}
                          onPress={() => void load(receipt, false)}
                        >
                          {t('View receipt', { defaultValue: 'Ansehen' })}
                        </Button>
                        <Button
                          style={{ minHeight: isNarrowWidth ? 44 : undefined }}
                          isDisabled={busy}
                          onPress={() => void load(receipt, true)}
                        >
                          <Trans>Download</Trans>
                        </Button>
                        <Button
                          style={{ minHeight: isNarrowWidth ? 44 : undefined }}
                          isDisabled={busy}
                          onPress={() => setDeleting(receipt.id)}
                        >
                          <Trans>Delete</Trans>
                        </Button>
                      </View>
                      {deleting === receipt.id && (
                        <View style={{ gap: 8, marginTop: 12 }}>
                          <div>
                            {t(
                              'Delete this receipt? The transaction will remain.',
                              {
                                defaultValue:
                                  'Diesen Beleg l�schen? Die Buchung bleibt erhalten.',
                              },
                            )}
                          </div>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Button
                              style={{
                                minHeight: isNarrowWidth ? 44 : undefined,
                              }}
                              isDisabled={busy}
                              onPress={() => setDeleting(null)}
                            >
                              <Trans>Cancel</Trans>
                            </Button>
                            <Button
                              style={{
                                minHeight: isNarrowWidth ? 44 : undefined,
                              }}
                              isDisabled={busy}
                              onPress={() => void remove(receipt.id)}
                            >
                              {t('Delete receipt', {
                                defaultValue: 'Beleg l�schen',
                              })}
                            </Button>
                          </View>
                        </View>
                      )}
                    </li>
                  ))}
                </ul>
                {preview && (
                  <View style={{ gap: 8 }}>
                    <Button
                      style={{ minHeight: isNarrowWidth ? 44 : undefined }}
                      onPress={() => setPreview(null)}
                    >
                      {t('Close preview', {
                        defaultValue: 'Vorschau schlie�en',
                      })}
                    </Button>
                    {preview.receipt.mime.startsWith('image/') ? (
                      <img
                        src={preview.url}
                        alt={preview.receipt.name}
                        style={{
                          maxWidth: '100%',
                          maxHeight: 400,
                          objectFit: 'contain',
                        }}
                      />
                    ) : (
                      <>
                        <iframe
                          src={preview.url}
                          title={preview.receipt.name}
                          style={{ width: '100%', height: 400, border: 0 }}
                        />
                        <div>
                          {t(
                            'If the PDF preview is unavailable, use Download to open the file.',
                            {
                              defaultValue:
                                'Falls dein Browser keine PDF-Vorschau zeigt, �ffne die Datei �ber "Herunterladen".',
                            },
                          )}
                        </div>
                      </>
                    )}
                  </View>
                )}
                <div style={{ color: theme.pageText }}>
                  {t(
                    'Receipts are included in the server backup, but not in the usual budget export.',
                    {
                      defaultValue:
                        'Belege geh�ren zur Serversicherung. Der normale Budgetexport enth�lt sie noch nicht.',
                    },
                  )}
                </div>
              </>
            )}
          </View>
        </>
      )}
    </Modal>
  );
}

