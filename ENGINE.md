# 0.9.0 Э������

## �ֹ��������

Codex�е����󡢼ܹ������Ӵ��롢�ؼ��жϡ����Ϻ��������ա���ȷ�����㽻���޶���Ŀ�ڵ�Node�ű���DSH�е��о���ժҪ��������������ȡ����������executor��ѡdsh/script/codex��role��ѡexecutor/critic��critic����ȷҪ��������˺Ͳ�ͬ���裬�������ظ����н��ۡ��۵㲻ͬ��������ʵ��ȷ��������Codex�˲顣

planning��дitems��sources��expectedSteps��outputChars��reviewSeconds��handoffSeconds��risk��Ԥ�����Щ�ֶ���������Ƶ����Կ��˹����ǣ���Ԥ�������뽻��ʱ�����ֱ�Ӵ���ʱ�䣬��risk=high������Codex�������Զ�����ȫ����Ŀ��ģ�ͣ�����ŵ��ʡǮ��

## �����벢��

`node scripts/orchestrate.mjs enqueue TASK.json OPTIONS.json`��OPTIONS֧��executor��role��dependsOn��priority��writeScope��·�����ʵ�ʲ��skills/dsh-assistantĿ¼��������ճ־û����û�״̬engine.json��Ĭ��2������DSH worker������concurrency 1..8��������ͬĿ��/����/����/��ɫȥ�أ������ļ��仯����ʽ����������ˢ��ȥ�ؼ���

`orchestrate.mjs run`ǰִ̨�����е�ǰ����������������accepted�ŷ��У�ʧ������תCodex���֡�����writeScope�ص��������С���Ϊ����Լ��������OSɳ�䡣DSH worker�����Ự��״̬Ŀ¼���ɻỰ��������ǰCodex��ͬʱ�����ӹ��������߷��ػỰIDʱ������ȴ��Ͳ鿴status����Ҫ������Ͷ�ݵ���ɡ�

û�к�̨�Զ����ѵ�ǰ���죻Codex���������ڴ�������������ش�����ɣ��������ڶ���Codex��������/������״̬���ֺ����ر�������˲��ִ�У�����ͣ��״̬��¼�ϡ��û�ȡ��������ֹͣ������ȡ������ʧ�ܺ��������

## ʧ�ܱ���

�κ�DSHʧ�ܼ�¼ԭ�����н���͹����Ự��״̬needs_codex������ʹ��takeover JOB_ID COMPLETION.json�Ǽ��Լ�����ɽ����֤�����ѡ�ļ�����ȡ��δȷ����cancel_pending������worker���������øò�λ��confirm-stopֻ��ȷ�ϻỰֹͣ������Ϊ�պ���С��޷�ȷ��ʱ���Զ����ƽ��ְ�ȫ��

cancel֧���Ŷ�����ִ������DSHͨ�������ļ�����ȡ�����ű���������workerֹͣ��recover���ھ�pump�����Ѳ����ʱ�ָ�����������Ҫ��ֹͣȷ�ϡ������Ƕϵ������ָ���Ҳ���ǿ�����ֲ�ʽ���С�

## ��̬Ԥ��������

`orchestrate.mjs allocate JOB_ID PATCH.json ��������`�ɵ����Ŷ�����������е�DSHԤ�㡣PATCHΪbudget��timeoutMs�ȣ�������runner��ȡ�����ļ������±����޶��steer֪ͨDSH��дallocationHistory��ʱ���Ǳ���ִ���������ʱ�������ܸ����ѽ�������steer�����������������ȣ�����calls�������������Զ����룬���ظ��ݽ�չ������

correct JOB_ID OPTIONS.jsonҪ��errorType(content/format/missing-evidence/tool-failure)��feedback��reason��predictedSeconds��maxAttempts(1..5)������ÿ�ν���뷴���������������߹��ϻ�����Ԥ�Ʋ����㣬ֱ��needs_codex�����ǹ̶�ֻ����һ�Σ�û�������Զ����ԡ�

## ���������

֧��timed-plan��ͨ��json��Լ��required��arrayField��exactItems/minItems��itemRequired��uniqueBy���ṹ/����ʧ�ܲ�ͨ������Դ��α��ҵ����ȷ������Codex�˲顣

����review/takeover�뵥����review���Զ�ά�������֪ʶ������ֻ�������յ�����֤��������׷����Ŀ������ģ��ԭ�ظ�����ʵ������Ŀ��Χ��������ļ�hash�����������Զ��������3����ؾ��������ʾ��memory����ɼ������ܾ����ļ��仯��ʹ��ĿʧЧ��Ӧ��֪ʶ�ⲻд��Codexȫ��memoryĿ¼��

maintainĬ�Ͻ�30��������������̬��־ѹ���鵵������SHA256����������δ����/ȡ��δȷ�ϼ�¼��`maintain --cleanup`��ɾ������������(Ĭ��180��)�Ĺ鵵��API�����ñ����ڣ������ļ�����ﲻ����ɾ������ʷ��ҳ��DSH��ʵbeforeSeq/throughSeqЭ�飬��������ȱҳ��ȥ�أ�ʧ���Ա�����ֹ��

## ͳ���뿴��

manage metrics�������ġ�������״̬��������token���ܣ�orchestrate dashboard���ɱ���HTML���ա���־����׼��ʱ�䡢pipelineElapsedMs�����ĵȴ�ʱ�䣻�ȴ�ʱ�䲻�������˹���ʱ������δ֪����������Щָ��ֱ������ʡǮ��

## GitHub����

update.mjs configure HTTPS_MANIFEST --auto-apply������ȷִ�л��������ǰ�������鲢���£�������ʱ�����̨��ʱ���ѡ�check/apply�ɵ���ִ�С���֤SemVer��HTTPS��SHA256��ZIP·��/��С/CRC��ȫ��worker���вŰ�װ�����������İ�װ�������³ɹ���Ҫ����°汾����ԭ���񣬲��ھɴ�����̼���ִ�С�GitHub public�ֿ�ֻ����Դ�롢�������������������״̬��ƾ�ݡ�
