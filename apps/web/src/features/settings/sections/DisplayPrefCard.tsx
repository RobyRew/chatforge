import { useState, type ReactNode } from 'react';
import { getDisplayAs, setDisplayAs, type DisplayAs } from '../../../lib/displayPref';
import { Segmented } from '../../../ui/controls';
import { Card } from '../../../ui/kit';

export function DisplayPrefCard(): ReactNode {
  const [as, setAs] = useState<DisplayAs>(getDisplayAs());
  return (
    <Card icon="users" title="Show people as" description="How other people are labelled in your chats; applies as you navigate.">
      <Segmented<DisplayAs>
        label="Show people as"
        value={as}
        onChange={(opt) => {
          setDisplayAs(opt);
          setAs(opt);
        }}
        options={[
          { value: 'name', label: 'Name' },
          { value: 'username', label: 'Username' },
          { value: 'email', label: 'Email' },
        ]}
      />
    </Card>
  );
}
