import React, { useState } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';

const GroupMediaTab = ({ messages, members }) => {
    const { t } = usePlatform();
    const [mediaSubTab, setMediaSubTab] = useState('media'); // files, media, links

    // Auto-scrape Media Assets from Messages
    const mediaAssets = messages.flatMap(m => m.attachments ? m.attachments.filter(a => a.type.startsWith('image/') || a.type.startsWith('video/')) : []);
    const docFiles = messages.flatMap(m => m.attachments ? m.attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/')) : []);
    const sharedLinks = messages.flatMap(m => {
        if (!m.text) return [];
        const urls = m.text.match(/(https?:\/\/[^\s]+)/g) || [];
        return urls.map(url => ({ url, sender: members[m.sender_id]?.name || 'Unknown', time: m.created_at }));
    });

    return (
        <div className="si-vault">
            <div className="si-media-pills">
                <div className={`si-media-pill ${mediaSubTab === 'media' ? 'active' : ''}`} onClick={() => setMediaSubTab('media')}>{t('gmedia_tab_media', 'Media')}</div>
                <div className={`si-media-pill ${mediaSubTab === 'files' ? 'active' : ''}`} onClick={() => setMediaSubTab('files')}>{t('gmedia_tab_files', 'Files')}</div>
                <div className={`si-media-pill ${mediaSubTab === 'links' ? 'active' : ''}`} onClick={() => setMediaSubTab('links')}>{t('gmedia_tab_links', 'Links')}</div>
            </div>

            <div className="si-media-content">
                {mediaSubTab === 'media' && (
                    mediaAssets.length > 0 ? (
                        <div className="si-media-grid">
                            {mediaAssets.map((m, i) => (
                                <a href={m.url} target="_blank" rel="noopener noreferrer" className="si-media-thumb" key={i}>
                                    <img src={m.url} alt="Media" />
                                </a>
                            ))}
                        </div>
                    ) : <div className="si-vault-empty"><i className="fas fa-image"></i><p>{t('gmedia_no_media', 'No photos or videos yet.')}</p></div>
                )}

                {mediaSubTab === 'files' && (
                    docFiles.length > 0 ? (
                        <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                            {docFiles.map((f, i) => (
                                <a href={f.url} target="_blank" rel="noopener noreferrer" className="si-vault-item" key={i}>
                                    <div className="si-vault-icon"><i className="fas fa-file-pdf"></i></div>
                                    <div className="si-vault-info">
                                        <div className="si-vault-name">{f.name}</div>
                                        <div className="si-vault-meta">{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                                    </div>
                                </a>
                            ))}
                        </div>
                    ) : <div className="si-vault-empty"><i className="fas fa-file-alt"></i><p>{t('gmedia_no_files', 'No documents shared yet.')}</p></div>
                )}

                {mediaSubTab === 'links' && (
                    sharedLinks.length > 0 ? (
                        <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                            {sharedLinks.map((l, i) => (
                                <a href={l.url} target="_blank" rel="noopener noreferrer" className="si-vault-item" key={i}>
                                    <div className="si-vault-icon link"><i className="fas fa-link"></i></div>
                                    <div className="si-vault-info">
                                        <div className="si-vault-name link">{l.url}</div>
                                        <div className="si-vault-meta">{t('gmedia_from_sender', 'From {sender}').replace('{sender}', l.sender)}</div>
                                    </div>
                                </a>
                            ))}
                        </div>
                    ) : <div className="si-vault-empty"><i className="fas fa-link"></i><p>{t('gmedia_no_links', 'No links shared yet.')}</p></div>
                )}
            </div>
        </div>
    );
};

export default GroupMediaTab;