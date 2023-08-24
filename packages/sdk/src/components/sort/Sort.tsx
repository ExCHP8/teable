import type { ISort } from '@teable-group/core';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Label,
  Switch,
} from '@teable-group/ui-lib';
import { isEqual } from 'lodash';
import React, { useEffect, useState, useMemo } from 'react';
import { useDebounce } from 'react-use';
import { DraggableSortList } from './DraggableSortList';
import { SortFieldAddButton } from './SortFieldAddButton';
import { SortFieldCommand } from './SortFieldCommand';

interface ISortProps {
  children: (text: string, isActive: boolean) => React.ReactElement;
  sorts: ISort | null;
  onChange: (sort: ISort | null) => void;
}

function Sort(props: ISortProps) {
  const { children, onChange, sorts } = props;

  const [innerSorts, setInnerSorts] = useState(sorts);

  const selectedFields = useMemo(
    () => innerSorts?.sortObjs?.map((sort) => sort.fieldId) || [],
    [innerSorts?.sortObjs]
  );

  const sortButtonText =
    innerSorts?.shouldAutoSort && innerSorts?.sortObjs?.length
      ? `Sort By ${innerSorts?.sortObjs?.length} filed${
          innerSorts?.sortObjs?.length > 1 ? 's' : ''
        }`
      : 'Sort';

  useEffect(() => {
    // async from sharedb
    setInnerSorts(sorts);
  }, [sorts]);

  useDebounce(
    () => {
      /**
       * there only following scenarios to update
       * 1. only switch the shouldAutoSort
       * 2. only shouldAutoSort is true
       */
      if (isEqual(innerSorts, sorts)) {
        return;
      }

      const onlyAutoSortChange =
        isEqual(sorts?.sortObjs, innerSorts?.sortObjs) &&
        sorts?.shouldAutoSort !== innerSorts?.shouldAutoSort;

      if (onlyAutoSortChange) {
        onChange(innerSorts);
        return;
      }

      if (!innerSorts && sorts?.shouldAutoSort) {
        onChange(innerSorts);
        return;
      }

      innerSorts?.shouldAutoSort && onChange(innerSorts);
    },
    50,
    [innerSorts]
  );

  const fieldSelectHandler = (fieldId: string) => {
    setInnerSorts({
      sortObjs: [
        {
          fieldId: fieldId,
          order: 'asc',
        },
      ],
      shouldAutoSort: innerSorts
        ? innerSorts?.shouldAutoSort
        : sorts
        ? sorts?.shouldAutoSort
        : true,
    });
  };

  const switchHandler = (value: boolean) => {
    innerSorts &&
      setInnerSorts({
        sortObjs: [...innerSorts.sortObjs],
        shouldAutoSort: value,
      });
  };

  const fieldAddHandler = (value: string) => {
    innerSorts &&
      setInnerSorts({
        sortObjs: [
          ...innerSorts.sortObjs,
          {
            fieldId: value,
            order: 'asc',
          },
        ],
        shouldAutoSort: innerSorts.shouldAutoSort,
      });
  };

  const sortChangeHandler = (sorts: ISort['sortObjs']) => {
    if (sorts?.length) {
      innerSorts &&
        setInnerSorts({
          sortObjs: sorts,
          shouldAutoSort: innerSorts.shouldAutoSort,
        });
    } else {
      setInnerSorts(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children?.(sortButtonText, sortButtonText !== 'Sort')}
      </PopoverTrigger>

      <PopoverContent side="bottom" align="start" className="max-w-screen-md p-0 w-fit">
        <header className="mx-3">
          <div className="border-b py-3 text-xs">Sort by</div>
        </header>

        {innerSorts ? (
          <div className="flex flex-col">
            <div className="p-3 max-h-96 overflow-auto">
              {
                <DraggableSortList
                  sorts={innerSorts.sortObjs}
                  onChange={sortChangeHandler}
                  selectedFields={selectedFields}
                />
              }
            </div>
            <SortFieldAddButton onSelect={fieldAddHandler} selectedFields={selectedFields} />
          </div>
        ) : (
          <SortFieldCommand onSelect={fieldSelectHandler} />
        )}

        {innerSorts && (
          <footer className="bg-muted/20 px-3 flex items-center h-11 justify-between">
            <div className="flex items-center space-x-2">
              <Switch
                id="airplane-mode"
                className="scale-75"
                onCheckedChange={switchHandler}
                checked={innerSorts.shouldAutoSort}
              />
              <Label htmlFor="airplane-mode" className="text-sm cursor-pointer">
                Automatically sort records
              </Label>
            </div>

            {!innerSorts.shouldAutoSort && (
              <div className="flex justify-between items-center">
                <Button size="sm" className="ml-2 text-sm" onClick={() => onChange(innerSorts)}>
                  sort
                </Button>
              </div>
            )}
          </footer>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { Sort };