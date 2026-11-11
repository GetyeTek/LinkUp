import React, { useState } from 'react';

const MironSimulatorModal = ({ isOpen, onClose, onStartSimulation }) => {
    const [debugScriptText, setDebugScriptText] = useState('');

    if (!isOpen) return null;

    const handleRun = () => {
        if (!debugScriptText.trim()) return;
        onStartSimulation(debugScriptText);
    };

    return (
        <div className="ml-debug-modal-overlay" onClick={onClose}>
            <div className="ml-debug-modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="ml-debug-modal-header">
                    <div className="ml-debug-modal-title">
                        <i className="fas fa-flask"></i>
                        <h3>Lecture Script Visual Simulator</h3>
                    </div>
                    <button className="ml-debug-close" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
                <div className="ml-debug-modal-body">
                    <p className="ml-debug-hint">
                        Paste any raw script with <code>[[cue:...]]</code> tags. The simulator calculates pacing, triggers Steadicam zooms, mounts supporting images, and morphs takeaways in real time without audio!
                    </p>
                    <textarea 
                        className="ml-debug-textarea" 
                        value={debugScriptText} 
                        onChange={(e) => setDebugScriptText(e.target.value)}
                        placeholder="Paste raw script containing [[cue:...]] tags here..."
                        rows={9}
                    />
                    <div className="ml-debug-actions-bar">
                        <button 
                            className="ml-debug-sample-btn"
                            onClick={() => setDebugScriptText(`[[cue:section:1.1:ትርጓሜ እና የባዮ-ባህላዊ ዑደት]]
እንኳን ወደ አንትሮፖሎጂ ትምህርት ምዕራፍ አንድ በደህና መጣችሁ።
[[cue:page_block:12:3:1]]
የመማሪያ መጽሐፋችንን ገጽ 12 ላይ ያለውን ይህንን አንቀጽ ተመልከቱ።
[[cue:bullet:ባዮ-ባህላዊ ማንነት፦ የማይነጣጠሉ ሁለት ወሳኝ ምሰሶዎች]]
የሰው ልጅ ሁለት የማይነጣጠሉ ዋና ዋና ባህሪያት አሉት፦ ባዮሎጂካል እና ባህላዊ።
[[cue:show_image:U01_01_sec1.1_scope_human_diversity.png]]
ባህልና ባዮሎጂ አንዱ ሌላውን እንዴት እንደሚቀርጽ በዚህ ምስል ላይ በግልጽ እንመልከት።
[[cue:bullet:ዓለም አቀፍ ልዩነት፦ ከአርክቲክ አዳኞች እስከ አፍሪካ አርብቶ አደሮች]]
ከአርክቲክ አዳኞች እስከ አፍሪካ አርብቶ አደሮች ድረስ ያሉትን ልዩነቶች እናጠናለን።

[[cue:section:1.2:የአንትሮፖሎጂ ትርጓሜ ጥልቀት]]
ቀጥሎ ደግሞ በገጽ 12 ላይ የተተነተነውን ፍቺ እንይ።
[[cue:page_block:12:4:0]]
ይህንን ትርጓሜ በጥልቀት ስንመለከተው፣ አንትሮፖሎጂ የሰውን ልጅ ከጥንት እስከ ዛሬ በሙሉ ማንነቱ ይመረምራል።
[[cue:show_diagram:vis-04-subfield-taxonomy]]
[[cue:zoom:biological]]
[[cue:bullet:አራቱ ዘርፎች፦ ባዮሎጂካል፣ አርኪኦሎጂ፣ ሊንግዊስቲክስ እና ማህበራዊ]]
አንትሮፖሎጂ ጥናቱን በአራት ዋና ዋና ምሰሶዎች ይከፍላል።
[[cue:show_image:U01_02_sec1.2.1_paleo_fossil_excavation.png]]
በኢትዮጵያ ስምጥ ሸለቆ የተገኘችው ድንቅነሽ ወይም ሉሲ፣ በሁለት እግር መቆም ከአንጎል ማደግ እንደሚቀድም አረጋገጠች።`)}
                        >
                            <i className="fas fa-wand-magic-sparkles"></i> Load Anthro 1012 Sample (Textbook Block + Dual Stage)
                        </button>
                        <button 
                            className="ml-debug-start-btn"
                            onClick={handleRun}
                        >
                            <i className="fas fa-play"></i> Run Visual Simulation
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MironSimulatorModal;