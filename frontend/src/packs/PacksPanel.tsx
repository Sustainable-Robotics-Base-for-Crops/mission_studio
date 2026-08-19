import { useState, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input, Select } from '../design-system/Field';
import {
    CROP_PACKS,
    keepWorkOrdinalRange,
    reverseWorkTravel,
    skipEveryNthWorkSection,
    type CropPackId,
} from '../domain/crop-pack';
import type { AgriDocument } from '../domain/agri';

interface PacksPanelProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    pack: CropPackId;
    workCount: number;
    hasDocument: boolean;
    canGenerateBeds: boolean;
    onPackChange: (pack: CropPackId) => void;
    onMutate: (document: AgriDocument) => void;
    document: AgriDocument | null;
    skipN: string;
    onSkipNChange: (value: string) => void;
    onOpenTeach: () => void;
    onOpenApplyFields: () => void;
    onGenerate18Beds: () => void;
}

export function PacksPanel({
    t,
    pack,
    workCount,
    hasDocument,
    canGenerateBeds,
    onPackChange,
    onMutate,
    document,
    skipN,
    onSkipNChange,
    onOpenTeach,
    onOpenApplyFields,
    onGenerate18Beds,
}: PacksPanelProps): ReactElement {
    const [fromOrdinal, setFromOrdinal] = useState('1');
    const [toOrdinal, setToOrdinal] = useState(String(Math.max(workCount, 1)));

    const applySkip = () => {
        if (!document) {
            return;
        }
        const skip = Number(skipN);
        if (!Number.isFinite(skip) || skip < 1) {
            return;
        }
        onMutate(skipEveryNthWorkSection(document, Math.floor(skip)));
    };

    const applyRange = () => {
        if (!document) {
            return;
        }
        const from = Math.max(1, Math.floor(Number(fromOrdinal)) || 1);
        const to = Math.max(from, Math.floor(Number(toOrdinal)) || workCount);
        onMutate(keepWorkOrdinalRange(document, from, to));
    };

    return (
        <div className="studio-packs">
            <h3>{t('pack.title')}</h3>
            <Select
                id="studio-crop-pack"
                label={t('pack.select')}
                value={pack}
                onValueChange={(value) => onPackChange(value as CropPackId)}
                options={CROP_PACKS.map((item) => ({
                    value: item,
                    label: t(`pack.${item}`),
                }))}
                help={t('pack.help')}
            />
            {pack === 'vineyard' ? (
                <>
                    <div className="studio-pack-row">
                        <Input
                            id="studio-pack-from"
                            label={t('pack.rangeFrom')}
                            value={fromOrdinal}
                            onChange={(event) => setFromOrdinal(event.target.value)}
                        />
                        <Input
                            id="studio-pack-to"
                            label={t('pack.rangeTo')}
                            value={toOrdinal}
                            onChange={(event) => setToOrdinal(event.target.value)}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={!hasDocument || workCount === 0}
                        onClick={applyRange}
                    >
                        {t('pack.applyRange')}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={!hasDocument}
                        onClick={() => document && onMutate(reverseWorkTravel(document))}
                    >
                        {t('pack.reverseTravel')}
                    </Button>
                    <Input
                        id="studio-pack-skip-vine"
                        label={t('pack.skipN')}
                        value={skipN}
                        onChange={(event) => onSkipNChange(event.target.value)}
                        help={t('pack.skipHelp')}
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={!hasDocument}
                        onClick={applySkip}
                    >
                        {t('pack.applySkip')}
                    </Button>
                    <p className="studio-muted">{t('pack.skip.fleet')}</p>
                </>
            ) : null}
            {pack === 'open_field' ? (
                <>
                    <Input
                        id="studio-pack-skip-field"
                        label={t('pack.skipN')}
                        value={skipN}
                        onChange={(event) => onSkipNChange(event.target.value)}
                        help={t('pack.skipHelp')}
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={!hasDocument}
                        onClick={applySkip}
                    >
                        {t('pack.applySkip')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={onOpenApplyFields}>
                        {t('pack.applyFields')}
                    </Button>
                </>
            ) : null}
            {pack === 'market_garden' ? (
                <>
                    <Button type="button" variant="secondary" onClick={onGenerate18Beds}>
                        {canGenerateBeds ? t('pack.generateBeds18') : t('pack.needAxis')}
                    </Button>
                    <p className="studio-muted">{t('pack.skip.plants')}</p>
                </>
            ) : null}
            <Button type="button" variant="secondary" onClick={onOpenTeach}>
                {t('teach.open')}
            </Button>
            <p className="studio-muted">{t('pack.workCount', { count: workCount })}</p>
        </div>
    );
}
