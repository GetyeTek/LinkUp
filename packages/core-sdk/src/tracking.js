import { supabase } from './supabaseClient.js';

export const evaluateQuestionAnswer = (q, userAnswer) => {
    if (!q || userAnswer === undefined || userAnswer === null) return { isCorrect: false };
    const qType = (q.question_type || '').toLowerCase();
    let isCorrect = false;

    if (qType === 'true_false') {
        const boolAns = userAnswer === 'True' || userAnswer?.text === 'True';
        isCorrect = (boolAns === q.correct_answer);
    } else if (qType === 'multiple_choice' || qType === 'reading_comprehension') {
        let selectedIdx = -1;
        if (typeof userAnswer === 'number') {
            selectedIdx = userAnswer;
        } else {
            const ansText = typeof userAnswer === 'object' ? (userAnswer.text ?? JSON.stringify(userAnswer)) : String(userAnswer);
            q.options?.forEach((opt, idx) => {
                const optText = typeof opt === 'object' ? (opt.text ?? JSON.stringify(opt)) : String(opt);
                if (optText === ansText) selectedIdx = idx;
            });
        }
        const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer;
        isCorrect = (selectedIdx !== -1 && selectedIdx === correctIdx);
    } else if (qType === 'matching') {
        if (q.correct_answer && typeof q.correct_answer === 'object' && userAnswer && typeof userAnswer === 'object') {
            const keys = Object.keys(q.correct_answer);
            if (keys.length > 0) {
                isCorrect = keys.every(k => userAnswer[k] === q.correct_answer[k]);
            }
        }
    } else if (qType === 'fill_in_the_blank') {
        if (Array.isArray(q.correct_answer) && Array.isArray(userAnswer)) {
            isCorrect = q.correct_answer.length > 0 && q.correct_answer.every((ans, i) => {
                return (userAnswer[i] || '').toLowerCase().trim() === (ans || '').toLowerCase().trim();
            });
        } else if (typeof q.correct_answer === 'string' && typeof userAnswer === 'string') {
            isCorrect = q.correct_answer.toLowerCase().trim() === userAnswer.toLowerCase().trim();
        }
    } else {
        isCorrect = true;
    }

    return { isCorrect };
};

export const logQuestionAttempt = async ({
    userId,
    questionId = null,
    courseCode = 'Unknown',
    topicTag = 'General',
    sourceType = 'exam',
    sourceId = null,
    userAnswer
}) => {
    if (!userId) return null;
    try {
        const { data, error } = await supabase.rpc('submit_question_attempt', {
            p_question_id: questionId,
            p_user_answer: typeof userAnswer === 'object' ? userAnswer : JSON.parse(JSON.stringify(userAnswer || null)),
            p_source_type: sourceType,
            p_source_id: sourceId,
            p_topic_tag: topicTag,
            p_course_code: courseCode
        });
        if (error) {
            console.error("Attempt evaluation failed:", error);
            return null;
        }
        return data;
    } catch (e) {
        console.error("Attempt evaluation error:", e);
        return null;
    }
};

export const logBatchQuestionAttempts = async (attempts = []) => {
    if (!Array.isArray(attempts) || attempts.length === 0) return null;
    try {
        const payload = attempts.map(att => ({
            question_id: att.questionId || null,
            user_answer: typeof att.userAnswer === 'object' ? att.userAnswer : JSON.parse(JSON.stringify(att.userAnswer || null)),
            source_type: att.sourceType || 'exam',
            source_id: att.sourceId ? String(att.sourceId) : null,
            topic_tag: att.topicTag || 'General',
            course_code: att.courseCode || 'Unknown'
        }));

        const { data, error } = await supabase.rpc('submit_question_attempts_batch', {
            p_attempts: payload
        });

        if (error) {
            console.warn("[Tracking] Batch RPC unavailable, falling back to sequential:", error.message);
            for (const att of attempts) {
                await logQuestionAttempt(att);
            }
            return null;
        }
        return data;
    } catch (e) {
        console.error("[Tracking] Batch attempt log error:", e);
        return null;
    }
};