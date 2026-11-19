'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Phaser from 'phaser';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { type Activity, type Employee, channelNames, dateLabel, employeeActivity, employeeStatus } from './data';
import { desks, drawAvatar, drawOffice, floorSize, paint } from './office-art';

const statusColors: Record<string, number> = {
  Working: 0x6bce95, 'Delegated work': 0x84b4f4, 'Awaiting approval': 0xf7bf67, Failed: 0xe77e7c, Idle: 0xc4b9a2,
};
const eventNames = { task: 'Task', delegation: 'Delegation', review: 'Review', web: 'Conversation', ...channelNames };
type Occupant = { employee: Employee; status: string; selected: boolean };

class Floor extends Phaser.Scene {
  private people?: Phaser.GameObjects.Container;
  private previous = '';
  private ready = false;
  constructor(private current: () => Occupant[], private select: (id: string) => void) { super('office'); }

  create() {
    const backdrop = this.add.graphics();
    drawOffice(backdrop);
    backdrop.generateTexture('office-floor', floorSize.width, floorSize.height);
    backdrop.destroy();
    this.add.image(0, 0, 'office-floor').setOrigin(0);
    const labels: [string, number, number][] = [
      ['Quiet room', 54, 87], ['Library', 272, 87], ['Meeting room', 490, 87], ['Lounge', 54, 455],
    ];
    labels.forEach(([label, x, y]) => this.add.text(x, y, label, {
      fontFamily: 'system-ui, sans-serif', fontStyle: 'bold', fontSize: '12px',
      color: '#fff3de', backgroundColor: '#51453b', padding: { x: 8, y: 3 },
    }));
    this.ready = true;
    this.renderPeople();
  }

  renderPeople() {
    if (!this.ready) return;
    const occupants = this.current();
    const key = JSON.stringify(occupants.map(({ employee, status, selected }) => [employee.id, employee.name, status, selected]));
    if (key === this.previous) return;
    this.previous = key;
    this.people?.destroy(true);
    this.people = this.add.container();
    occupants.forEach(({ employee, status, selected }, index) => {
      const [x, deskY] = desks[index];
      const y = deskY + 40;
      const actor = this.add.graphics();
      actor.fillStyle(0x483c33, .31).fillEllipse(x, y + 16, 35, 10);
      if (selected) actor.lineStyle(2, 0xffedb4, .95).strokeEllipse(x, y + 16, 39, 13);
      drawAvatar(paint(actor), employee.id, x - 16, y - 15);
      actor.fillStyle(0x413c34).fillCircle(x + 20, y - 9, 5);
      actor.fillStyle(statusColors[status]).fillCircle(x + 20, y - 9, 3);
      const name = this.add.text(x, y + 23, employee.name.slice(0, 20), {
        fontSize: '13px', fontFamily: 'system-ui, sans-serif', fontStyle: 'bold', color: '#fff6e5',
        backgroundColor: selected ? '#284d74' : '#493e33', padding: { x: 7, y: 3 },
      }).setOrigin(.5, 0);
      const hit = this.add.zone(x, y + 8, 128, 62).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.select(employee.id));
      this.people?.add([actor, name, hit]);
    });
  }
}

export default function Office({ employees, activity, choice, select, openTask }: {
  employees: Employee[]; activity: Activity[]; choice: string; select: (id: string) => void; openTask: (id: string) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<Floor>(null);
  const current = useRef<Occupant[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const pages = Math.max(1, Math.ceil(employees.length / desks.length));
  const selectedIndex = employees.findIndex(employee => employee.id === choice);
  const floor = selectedIndex >= 0 ? Math.floor(selectedIndex / desks.length) : Math.min(page, pages - 1);
  useEffect(() => { setPage(floor); }, [floor]);
  const onFloor = useMemo(() => employees.slice(floor * desks.length, (floor + 1) * desks.length), [employees, floor]);
  const employee = selectedIndex >= 0 ? employees[selectedIndex] : onFloor[0];
  const occupants = useMemo(() => onFloor.map(person => ({
    employee: person,
    status: employeeStatus(employeeActivity(activity, person.id)),
    selected: person.id === choice,
  })), [onFloor, activity, choice]);
  const entry = employee && employeeActivity(activity, employee.id);
  const recent = activity.filter(event => event.employee_id === employee?.id);
  const task = recent.find(event => event.task_id);
  const query = search.trim().toLocaleLowerCase();
  const matching = query ? employees.filter(person => `${person.name} ${person.role}`.toLocaleLowerCase().includes(query)) : [];

  function changeFloor(next: number) {
    setPage(next);
    if (selectedIndex >= 0) select(employees[next * desks.length]?.id ?? '');
  }

  useEffect(() => {
    if (!mount.current) return;
    const floorScene = new Floor(() => current.current, select);
    scene.current = floorScene;
    const game = new Phaser.Game({
      parent: mount.current, type: Phaser.CANVAS, scene: floorScene, pixelArt: true, banner: false,
      audio: { noAudio: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, ...floorSize },
    });
    const observer = new ResizeObserver(() => {
      if (game.isBooted && game.scale.parent) game.scale.refresh();
    });
    observer.observe(mount.current);
    return () => { observer.disconnect(); scene.current = null; game.destroy(true); };
  }, [select]);
  useEffect(() => {
    current.current = occupants;
    scene.current?.renderPeople();
  }, [occupants]);

  return <section className="office-panel" aria-label="Office floor">
    {pages > 1 && <div className="floor-toolbar">
      <label>Find employee<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or role" /></label>
      <label>Floor<select value={floor} onChange={event => changeFloor(Number(event.target.value))}>
        {Array.from({ length: pages }, (_, index) => <option key={index} value={index}>Floor {index + 1} of {pages}</option>)}
      </select></label>
      {query && <div className="floor-matches" aria-label="Matching employees">
        <small role="status">{matching.length ? `${matching.length} found${matching.length > 8 ? ' · showing the first 8' : ''}` : 'No matching employees.'}</small>
        {matching.slice(0, 8).map(person => <button type="button" key={person.id} title={person.role}
          onClick={() => { setSearch(''); select(person.id); }}>{person.name}</button>)}
      </div>}
    </div>}
    <div className="floor" ref={mount} aria-hidden />
    {onFloor.length > 0 && <div className="floor-roster" role="group" aria-label="Employees on this floor">
      {onFloor.map(person => <button type="button" key={person.id} aria-pressed={person.id === choice}
        title={person.name} onClick={() => select(person.id)}>{person.name}</button>)}
    </div>}
    <div className="floor-footer">
      {employee ? <>
        <div className="floor-person">
          <span className="floor-status" style={{ background: '#' + statusColors[employeeStatus(entry)].toString(16) }} />
          <div><strong>{employee.name}</strong><small>{employee.role} · {employeeStatus(entry)}</small></div>
        </div>
        <div className="actions">
          {task?.task_id && <button onClick={() => openTask(task.task_id!)}>Open latest task <ArrowUpRight size={14} /></button>}
          {pages > 1 && <div className="floor-pages">
            <button className="icon" aria-label="Previous office floor" disabled={!floor} onClick={() => changeFloor(floor - 1)}><ChevronLeft size={16} /></button>
            <small>{floor + 1} / {pages}</small>
            <button className="icon" aria-label="Next office floor" disabled={floor === pages - 1} onClick={() => changeFloor(floor + 1)}><ChevronRight size={16} /></button>
          </div>}
        </div>
      </> : <small>Add an AI employee under People to populate the office.</small>}
    </div>
    {recent.length > 0 && <details className="floor-activity" key={employee?.id}>
      <summary>Recent activity</summary>
      <ul>{recent.slice(0, 5).map(event => <li key={event.id}>
        <div><strong>{eventNames[event.kind]}</strong><small>{event.status} · {dateLabel(event.started_at)}</small></div>
        {event.task_id ? <button className="icon" aria-label={'Open ' + eventNames[event.kind].toLowerCase()}
          onClick={() => openTask(event.task_id!)}><ArrowUpRight size={14} /></button>
          : event.can_open_chat && <button className="icon" aria-label="Open conversation"
            onClick={() => select(Object.hasOwn(channelNames, event.kind) ? event.kind : event.employee_id)}><ArrowUpRight size={14} /></button>}
      </li>)}</ul>
    </details>}
  </section>;
}
