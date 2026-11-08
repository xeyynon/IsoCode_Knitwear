// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { Button, ButtonLink } from '../src/ui/atoms/Button'
import { TextLink, LinkButton } from '../src/ui/atoms/TextLink'
import { Input, Select, Textarea } from '../src/ui/atoms/Input'
import { ErrorText } from '../src/ui/atoms/ErrorText'
import { Banner } from '../src/ui/atoms/Banner'
import { Card } from '../src/ui/atoms/Card'
import { Chip } from '../src/ui/atoms/Chip'
import { Field } from '../src/ui/molecules/Field'
import { cx } from '../src/ui/atoms/cx'

// UI/UX plan, slice 2.1: the atoms must draw EXACTLY the markup the pages used to write by hand, so a page that moves to them changes nothing on
// screen or in the accessibility tree. Each case below is the old hand-written markup on the right.
const html = (el: ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>).container.innerHTML

describe('cx', () => {
  it('joins the strings and skips everything else', () => {
    expect(cx('a', false, undefined, null, '', 'b')).toBe('a b')
  })
})

describe('Button and ButtonLink', () => {
  it('the plain button', () => expect(html(<Button>Refresh</Button>)).toBe('<button class="btn">Refresh</button>'))
  it('the one filled button', () => expect(html(<Button variant="primary">Save</Button>)).toBe('<button class="btn btn--primary">Save</button>'))
  it('Send: filled and full width, disabled while it cannot be used', () =>
    expect(html(<Button variant="primary" block disabled>Send</Button>)).toBe('<button class="btn btn--primary btn--block" disabled="">Send</button>'))
  it('a small button, a big one, a strong one, each in the old class order', () => {
    expect(html(<Button size="small">Clear</Button>)).toBe('<button class="btn btn--small">Clear</button>')
    expect(html(<Button size="big">Big</Button>)).toBe('<button class="btn btn--big">Big</button>')
    expect(html(<Button strong>Strong</Button>)).toBe('<button class="btn btn--strong">Strong</button>')
    expect(html(<Button variant="primary" size="small">Go</Button>)).toBe('<button class="btn btn--primary btn--small">Go</button>')
  })
  it('keeps a page\'s own class after its own, and adds no type (a button in a form still submits)', () => {
    expect(html(<Button className="stage__go">Go</Button>)).toBe('<button class="btn stage__go">Go</button>')
    expect(html(<Button>Go</Button>)).not.toContain('type=')
  })
  it('passes every attribute through', () => {
    expect(html(<Button aria-pressed="true" title="t" onClick={() => {}}>x</Button>)).toBe('<button class="btn" aria-pressed="true" title="t">x</button>')
  })
  it('the link that looks like a button', () => {
    expect(html(<ButtonLink variant="primary" block to="/today" className="stage__go">Update</ButtonLink>)).toBe('<a class="btn btn--primary btn--block stage__go" href="/today" data-discover="true">Update</a>')
  })
})

describe('TextLink and LinkButton', () => {
  it('a router link as text', () => expect(html(<TextLink to="/x">See</TextLink>)).toBe('<a class="link" href="/x" data-discover="true">See</a>'))
  it('a button as text', () => expect(html(<LinkButton type="button">More</LinkButton>)).toBe('<button class="link" type="button">More</button>'))
})

describe('Input, Select, Textarea', () => {
  it('the plain input', () => expect(html(<Input value="a" onChange={() => {}} />)).toBe('<input class="input" value="a">'))
  it('the variants, in the old class order', () => {
    expect(html(<Input tall readOnly />)).toBe('<input class="input input--tall" readonly="">')
    expect(html(<Input big mono readOnly />)).toBe('<input class="input mono input--big" readonly="">')
    expect(html(<Input mono asking readOnly />)).toBe('<input class="input mono input--asking" readonly="">')
  })
  it('a select and a textarea', () => {
    expect(html(<Select defaultValue="a"><option value="a">A</option></Select>)).toBe('<select class="input"><option value="a" selected="">A</option></select>')
    expect(html(<Textarea defaultValue="" />)).toBe('<textarea class="input textarea"></textarea>')
  })
  it('hands the ref to the element (a page focuses its field)', () => {
    let el: HTMLInputElement | null = null
    render(<Input ref={(n) => { el = n }} readOnly />)
    expect(el).not.toBeNull()
  })
})

describe('ErrorText, Card, Chip, Field', () => {
  it('the error sentence, announced', () => expect(html(<ErrorText>Wrong</ErrorText>)).toBe('<p class="error" role="alert">Wrong</p>'))
  it('the banner: announced by default, with its own id, or told to be a status', () => {
    expect(html(<Banner>Full</Banner>)).toBe('<p class="banner" role="alert">Full</p>')
    expect(html(<Banner id="toomany">More</Banner>)).toBe('<p class="banner" role="alert" id="toomany">More</p>')
    expect(html(<Banner role="status">News</Banner>)).toBe('<p class="banner" role="status">News</p>')
  })
  it('a card, and a card that is a form', () => {
    expect(html(<Card>x</Card>)).toBe('<section class="card">x</section>')
    expect(html(<Card as="form" className="login__card" noValidate>x</Card>)).toBe('<form class="card login__card" novalidate="">x</form>')
  })
  it('a chip, with and without its status hook', () => {
    expect(html(<Chip aria-pressed={true}>All</Chip>)).toBe('<button class="chip" aria-pressed="true">All</button>')
    expect(html(<Chip tone="red" aria-pressed={false}>Late</Chip>)).toBe('<button class="chip chip--red" aria-pressed="false">Late</button>')
  })
  it('a field: the label words first, then the control, then what goes below it', () => {
    expect(html(<Field label="Email"><Input readOnly /></Field>)).toBe('<label class="field"><span>Email</span><input class="input" readonly=""></label>')
    expect(html(<Field label="Qty" below={<ErrorText>Bad</ErrorText>}><Input readOnly /></Field>))
      .toBe('<label class="field"><span>Qty</span><input class="input" readonly=""><p class="error" role="alert">Bad</p></label>')
  })
})
